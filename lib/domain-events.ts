import type { PoolConnection } from "mysql2/promise";
import { query, mutate } from "./db";
import { tenantId, withStore, withSystem } from "./tenant";
import { digest } from "./auth";
import webpush from "web-push";

// Persist the event in the same transaction as the order, before acknowledging it.
export async function emit(c: PoolConnection, key: string, payload: any) {
  await c.execute(
    "INSERT IGNORE INTO domain_outbox(store_id,event_key,payload) VALUES(?,?,?)",
    [tenantId(), key, JSON.stringify(payload)],
  );
}
export async function processDomainEvents(deadline = Date.now() + 15000) {
  return withSystem(async () => {
    const jobs = await query<any[]>(
      "SELECT * FROM domain_outbox WHERE status='pending' AND available_at<=NOW() ORDER BY id LIMIT 40",
    );
    for (const job of jobs) {
      if (Date.now() > deadline) break;
      const claim = await mutate(
        "UPDATE domain_outbox SET status='working',attempts=attempts+1,available_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=? AND status='pending'",
        [job.id],
      );
      if (!claim.affectedRows) continue;
      try {
        const p =
          typeof job.payload === "string"
            ? JSON.parse(job.payload)
            : job.payload;
        const targets =
          p.audience === "staff"
            ? await query<any[]>(
                "SELECT user_id,role FROM store_memberships WHERE store_id=? AND status='active'",
                [job.store_id],
              )
            : [{ user_id: p.userId, role: "customer" }];
        for (const t of targets) {
          if (Date.now() > deadline) throw Error("Worker budget reached");
          if (!t.user_id) continue;
          if (p.marketing) {
            const [consent] = await query<any[]>(
              "SELECT p.marketing FROM notification_preferences p JOIN users u ON u.id=p.user_id JOIN customers c ON c.email=u.email AND c.store_id=p.store_id JOIN stores s ON s.id=p.store_id WHERE p.user_id=? AND p.store_id=? AND p.marketing=1 AND c.marketing_consent=1 AND s.status='approved' AND EXISTS(SELECT 1 FROM orders o WHERE o.user_id=p.user_id AND o.store_id=p.store_id AND o.status='delivered')",
              [t.user_id, job.store_id],
            );
            if (!consent) continue;
          }
          if (
            p.audience === "staff" &&
            !["owner", "admin", "manager", "support"].includes(t.role)
          )
            continue;
          const href =
            p.href ||
            (p.audience === "staff"
              ? `/workspace/${job.store_id}/orders`
              : "/account/orders");
          const r = await mutate(
            "INSERT IGNORE INTO notifications(store_id,user_id,event_key,title,body,href) VALUES(?,?,?,?,?,?)",
            [
              job.store_id,
              t.user_id,
              job.event_key,
              p.title,
              p.body || "",
              href,
            ],
          );
          // Inbox deduplication means retries cannot send the same push repeatedly.
          if (
            r.affectedRows &&
            process.env.VAPID_PRIVATE_KEY &&
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
          ) {
            const [preference] = await query<any[]>(
              "SELECT push FROM notification_preferences WHERE user_id=? AND store_id=?",
              [t.user_id, job.store_id],
            );
            if (preference?.push) {
              webpush.setVapidDetails(
                process.env.VAPID_SUBJECT || "mailto:admin@example.com",
                process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
                process.env.VAPID_PRIVATE_KEY,
              );
              const endpoints = await query<any[]>(
                "SELECT * FROM push_subscriptions WHERE user_id=?",
                [t.user_id],
              );
              for (const e of endpoints)
                try {
                  await webpush.sendNotification(
                    typeof e.subscription === "string"
                      ? JSON.parse(e.subscription)
                      : e.subscription,
                    JSON.stringify({ title: p.title, body: p.body, url: href }),
                    { TTL: 3600, timeout: 3000 },
                  );
                } catch (error: any) {
                  if ([404, 410].includes(error.statusCode))
                    await mutate("DELETE FROM push_subscriptions WHERE id=?", [
                      e.id,
                    ]);
                }
            }
          }
        }
        await mutate(
          "UPDATE domain_outbox SET status='done',last_error=NULL WHERE id=?",
          [job.id],
        );
      } catch {
        await mutate(
          "UPDATE domain_outbox SET status=IF(attempts>=5,'failed','pending'),available_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE),last_error='delivery_failed' WHERE id=?",
          [job.id],
        );
      }
    }
    await mutate(
      "UPDATE domain_outbox SET status='pending' WHERE status='working' AND available_at<NOW()",
    );
    return { processed: jobs.length };
  });
}
export const endpointHash = (s: string) => digest(s);
