import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { createHash } from "node:crypto";
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated SaaS QA database on port 3310");
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
});
const hash = (s) => createHash("sha256").update(s).digest("hex");
let count = 0;
function check(ok, label) {
  assert(ok, label);
  count++;
  console.log("PASS", label);
}
function client(initial = new Map()) {
  const jar = initial;
  return {
    jar,
    async call(path, method = "GET", body, status = 200, store = "1") {
      const r = await fetch(base + "/api/" + path, {
        method,
        headers: {
          origin: base,
          "content-type": "application/json",
          "x-fleur-store": String(store),
          cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const h of r.headers.getSetCookie()) {
        const [k, v] = h.split(";")[0].split("=");
        if (!v || /Max-Age=0/i.test(h)) jar.delete(k);
        else jar.set(k, v);
      }
      const d = await r.json();
      assert.equal(r.status, status, path + ": " + JSON.stringify(d));
      return d;
    },
  };
}
const password = "Platform-Users-QA-2026",
  stamp = Date.now(),
  why = "Kiểm thử quản trị tài khoản";
try {
  await db.execute("DELETE FROM login_attempts");
  const admin = client(),
    anon = client(),
    buyer = client();
  await admin.call("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const actor = (await admin.call("auth/me")).user;
  await db.execute(
    "INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)",
    [actor.id],
  );
  const fields = {
    name: "Platform QA " + stamp,
    email: `platform-${stamp}@example.test`,
    phone: "0901234567",
    address: "Địa chỉ QA",
    password,
    active: true,
    platformAdmin: false,
    reason: why,
  };
  await anon.call("platform/users", "POST", fields, 401);
  check(true, "Anonymous cannot manage platform accounts");
  const created = await admin.call("platform/users", "POST", fields),
    uid = created.id;
  await admin.call("platform/users", "POST", fields, 409);
  check(true, "Duplicate email returns actionable conflict");
  let profile = (await admin.call("platform/users/" + uid)).user;
  check(
    profile.email === fields.email &&
      !JSON.stringify(profile).includes("password"),
    "Account created and read without credentials",
  );
  const list = await admin.call(
    "platform/users?q=" + encodeURIComponent(fields.email),
  );
  check(
    list.total === 1 && list.users[0].id === uid,
    "Server search and pagination return correct accounts",
  );
  await buyer.call("auth/login", "POST", { email: fields.email, password });
  await buyer.call("platform/users", "GET", undefined, 403);
  check(true, "Normal user cannot read platform users");
  await admin.call("platform/users/" + uid, "PATCH", {
    ...fields,
    name: "Đã chỉnh sửa",
    password: "",
    version: profile.version,
  });
  await admin.call(
    "platform/users/" + uid,
    "PATCH",
    { ...fields, password: "", version: profile.version },
    409,
  );
  check(true, "Stale edits cannot overwrite newer account data");
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call("platform/users/" + uid, "PATCH", {
    ...fields,
    password: "",
    active: false,
    version: profile.version,
  });
  check(
    (await buyer.call("auth/me")).user === null,
    "Lock immediately revokes existing login",
  );
  await buyer.call(
    "auth/login",
    "POST",
    { email: fields.email, password },
    401,
  );
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call("platform/users/" + uid, "PATCH", {
    ...fields,
    password: "",
    version: profile.version,
  });
  const own = (await admin.call("platform/users/" + actor.id)).user;
  const ownFields = {
    ...own,
    active: false,
    platformAdmin: true,
    password: "",
    version: own.version,
    reason: why,
  };
  await admin.call("platform/users/" + actor.id, "PATCH", ownFields, 409);
  await admin.call(
    "platform/users/" + actor.id,
    "DELETE",
    { version: own.version, reason: why },
    409,
  );
  check(true, "Admin cannot lock or delete itself");
  const admin2 = client(new Map(admin.jar));
  const started = await admin.call("platform/users/" + uid + "/ghost", "POST", {
    reason: why,
  });
  check(started.redirect === "/", "Buyer Ghost redirects to marketplace");
  const ghost = await admin.call("auth/me");
  check(
    ghost.user.id === uid &&
      ghost.user.platformRole === null &&
      ghost.ghost.valid &&
      ghost.ghost.actorId === actor.id,
    "Ghost has target identity and retains actor attribution",
  );
  await admin.call("platform/users", "GET", undefined, 403);
  await admin.call(
    "platform/users/" + uid + "/ghost",
    "POST",
    { reason: why },
    403,
  );
  check(true, "Ghost cannot access platform or nest sessions");
  await admin.call("account", "PATCH", {}, 403);
  await admin.call("account/password", "POST", {}, 403);
  await admin.call("push", "POST", {}, 403);
  await admin.call("workspace/team/invite", "POST", {}, 403);
  await admin.call(
    "auth/login",
    "POST",
    { email: fields.email, password },
    403,
  );
  check(true, "Ghost blocks identity, password, team and push changes");
  const foreign = client(
    new Map([["fleur_ghost", admin.jar.get("fleur_ghost")]]),
  );
  check(
    (await foreign.call("auth/me")).user === null,
    "Ghost cookie alone cannot authenticate",
  );
  const separate = client();
  await separate.call("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  separate.jar.set("fleur_ghost", admin.jar.get("fleur_ghost"));
  check(
    (await separate.call("auth/me")).user === null,
    "Ghost cookie is bound to original admin session",
  );
  await db.execute(
    "UPDATE ghost_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE token_hash=?",
    [hash(admin.jar.get("fleur_ghost"))],
  );
  check(
    (await admin.call("auth/me")).user === null,
    "Expired Ghost does not fall back to elevated admin identity",
  );
  await admin.call("checkout", "POST", {}, 403);
  const stopped = await admin.call("auth/ghost/stop", "POST", {});
  check(
    stopped.redirect === "/platform/users" &&
      (await admin.call("auth/me")).user.id === actor.id,
    "Admin can return after Ghost expiry",
  );
  await admin.call("platform/users/" + uid + "/ghost", "POST", { reason: why });
  const latest = (await admin2.call("platform/users/" + uid)).user;
  await admin2.call("platform/users/" + uid, "PATCH", {
    ...fields,
    password: "",
    active: false,
    version: latest.version,
  });
  check(
    (await admin.call("auth/me")).user === null,
    "Target lock invalidates active Ghost immediately",
  );
  await admin.call("auth/ghost/stop", "POST", {});
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call("platform/users/" + uid, "PATCH", {
    ...fields,
    password: "",
    version: profile.version,
  });
  await admin.call(
    "platform/users/" + actor.id + "/ghost",
    "POST",
    { reason: why },
    403,
  );
  check(true, "Platform admins cannot be impersonated");
  await admin.call("platform/users/" + uid + "/ghost", "POST", { reason: why });
  await admin.call("inbox/read", "POST", { id: 0 }, 400); // Invalid payload still creates an attributable request audit.
  await admin.call("auth/ghost/stop", "POST", {});
  const [[audit]] = await db.query(
    "SELECT COUNT(*) n FROM platform_audit_logs WHERE actor_id=? AND target_id=? AND action='ghost:request'",
    [actor.id, uid],
  );
  check(audit.n > 0, "Ghost requests are audited under real admin and target");
  await buyer.call("auth/login", "POST", { email: fields.email, password });
  const store = await buyer.call("stores", "POST", {
    name: "QA Owner Store",
    slug: "user-qa-" + stamp,
    address: "QA address",
    phone: "0901234567",
  });
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call(
    "platform/users/" + uid,
    "DELETE",
    { version: profile.version, reason: why },
    409,
  );
  check(true, "Cannot delete owner of an unclosed store");
  await db.execute("UPDATE stores SET status='closed' WHERE id=?", [store.id]);
  await admin.call("platform/users/" + uid, "DELETE", {
    version: profile.version,
    reason: why,
  });
  check(
    (await buyer.call("auth/me")).user === null,
    "Soft deletion revokes buyer session",
  );
  const deleted = await admin.call(
    "platform/users?state=deleted&q=" + encodeURIComponent(fields.email),
  );
  check(
    deleted.users[0].id === uid && !!deleted.users[0].deleted_at,
    "Deleted accounts stay available in separate filter",
  );
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call(
    "platform/users/" + uid,
    "PATCH",
    { ...fields, password: "", version: profile.version },
    409,
  );
  await admin.call("platform/users/" + uid + "/restore", "POST", {
    version: profile.version,
    reason: why,
  });
  profile = (await admin.call("platform/users/" + uid)).user;
  check(
    !profile.deleted_at && !profile.active && !profile.platformAdmin,
    "Restore is locked and has no platform privileges",
  );
  const [[kept]] = await db.query(
    "SELECT COUNT(*) n FROM stores WHERE id=? AND owner_id=?",
    [store.id, uid],
  );
  check(kept.n === 1, "Soft deletion preserves store ownership history");
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call("platform/users/" + uid, "PATCH", {
    ...fields,
    password: "",
    platformAdmin: true,
    version: profile.version,
  });
  await buyer.call("auth/login", "POST", { email: fields.email, password });
  check(
    (await buyer.call("auth/me")).user.platformRole === "platform_admin",
    "Platform role can be granted explicitly",
  );
  profile = (await admin.call("platform/users/" + uid)).user;
  await admin.call("platform/users/" + uid, "PATCH", {
    ...fields,
    password: "",
    version: profile.version,
  });
  check(
    (await buyer.call("auth/me")).user === null,
    "Platform role revocation also revokes sessions",
  );
  const ownerGhost = await admin.call(
    "platform/users/" + uid + "/ghost",
    "POST",
    { reason: why },
  );
  check(
    ownerGhost.redirect === "/workspace/" + store.id,
    "Store owner Ghost redirects to its workspace",
  );
  await admin.call("workspace/order-list", "GET", undefined, 200, store.id);
  await admin.call("workspace/order-list", "GET", undefined, 403, "1");
  await admin.call(
    "workspace/calendar/notes",
    "POST",
    {
      title: "Ghost QA note",
      content: "Support QA",
      color: "#555555",
      day: "2026-10-20",
    },
    200,
    store.id,
  );
  const [[note]] = await db.query(
    "SELECT author_id FROM calendar_notes WHERE store_id=? AND title='Ghost QA note' ORDER BY id DESC LIMIT 1",
    [store.id],
  );
  check(
    note.author_id === uid,
    "Ghost uses actual store permissions and target authorship, with separate actor audit",
  );
  await admin.call("auth/ghost/stop", "POST", {});
  const source = client();
  await source.call("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  await source.call("platform/users/" + uid + "/ghost", "POST", {
    reason: why,
  });
  await db.execute("DELETE FROM sessions WHERE token_hash=?", [
    hash(source.jar.get("fleur_session")),
  ]);
  check(
    (await source.call("auth/me")).user === null,
    "Revoking original admin session also invalidates Ghost",
  );
  check(
    (await source.call("auth/ghost/stop", "POST", {})).redirect === "/login",
    "Ghost exit cannot restore revoked admin session",
  );
  const [[secret]] = await db.query(
    "SELECT COUNT(*) n FROM platform_audit_logs WHERE CAST(metadata AS CHAR) LIKE ?",
    ["%" + password + "%"],
  );
  check(secret.n === 0, "Audit never stores raw passwords");
  console.log(`Platform users: ${count} assertions passed`);
} finally {
  await db.end();
}
