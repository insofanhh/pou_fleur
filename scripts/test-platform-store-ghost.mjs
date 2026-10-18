import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { chromium, expect } from "@playwright/test";

if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated SaaS QA database on port 3310");
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
function client() {
  const jar = new Map();
  return {
    jar,
    async call(path, method = "GET", data, status = 200, store = 1) {
      const response = await fetch(base + "/api/" + path, {
        method,
        headers: {
          origin: base,
          "content-type": "application/json",
          "x-fleur-store": String(store),
          cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [key, value] = cookie.split(";")[0].split("=");
        if (!value || /Max-Age=0/i.test(cookie)) jar.delete(key);
        else jar.set(key, value);
      }
      const result = await response.json();
      assert.equal(
        response.status,
        status,
        path + ": " + JSON.stringify(result),
      );
      return result;
    },
  };
}
let passed = 0;
const check = (value, label) => {
  assert(value, label);
  passed++;
  console.log("PASS", label);
};
let browser;
try {
  await db.execute("DELETE FROM login_attempts");
  const admin = client(),
    owner = client(),
    anon = client();
  await admin.call("auth/login", "POST", {
    email: "owner@example.test",
    password: "SaaS-Testing-2026-Only",
  });
  const actor = (await admin.call("auth/me")).user;
  await db.execute(
    "INSERT IGNORE INTO platform_memberships(user_id) VALUES(?)",
    [actor.id],
  );
  const stamp = Date.now();
  const target = await owner.call("auth/register", "POST", {
    name: "Chủ store Ghost " + stamp,
    email: `store-ghost-${stamp}@example.test`,
    password: "Store-Ghost-QA-2026",
  });
  const uid = target.user.id;
  const first = await owner.call("stores", "POST", {
    name: "Store Ghost thứ nhất " + stamp,
    slug: "ghost-first-" + stamp,
    address: "123 Đường Hoa, Hồ Chí Minh",
    phone: "0901234567",
  });
  const second = await owner.call("stores", "POST", {
    name: "Store Ghost thứ hai " + stamp,
    slug: "ghost-second-" + stamp,
    address: "456 Đường Hoa, Hồ Chí Minh",
    phone: "0901234567",
  });
  const path = "platform/stores/" + second.id + "/ghost";
  const body = { reason: "Hỗ trợ cửa hàng kiểm thử" };
  await anon.call(path, "POST", body, 401);
  await owner.call(path, "POST", body, 403);
  check(true, "Only platform admin can Ghost a store owner");
  await admin.call(path, "POST", { reason: "" }, 400);
  await admin.call("platform/stores/2147483647/ghost", "POST", body, 404);
  check(
    !admin.jar.has("fleur_ghost"),
    "Invalid reason and nonexistent store do not open Ghost",
  );
  await db.execute("UPDATE users SET active=0 WHERE id=?", [uid]);
  await admin.call(path, "POST", body, 409);
  await db.execute("UPDATE users SET active=1 WHERE id=?", [uid]);
  await db.execute(
    "INSERT INTO platform_user_states(user_id,deleted_at) VALUES(?,NOW())",
    [uid],
  );
  await admin.call(path, "POST", body, 409);
  await db.execute(
    "UPDATE platform_user_states SET deleted_at=NULL WHERE user_id=?",
    [uid],
  );
  check(true, "Locked or deleted store owner cannot be impersonated");
  await db.execute(
    "UPDATE store_memberships SET status='revoked' WHERE store_id=? AND user_id=?",
    [second.id, uid],
  );
  await admin.call(path, "POST", body, 409);
  await db.execute(
    "UPDATE store_memberships SET status='active' WHERE store_id=? AND user_id=?",
    [second.id, uid],
  );
  await db.execute("INSERT INTO platform_memberships(user_id) VALUES(?)", [
    uid,
  ]);
  await admin.call(path, "POST", body, 403);
  await db.execute("DELETE FROM platform_memberships WHERE user_id=?", [uid]);
  check(
    true,
    "Revoked owner membership and platform-admin target are rejected",
  );
  const opened = await admin.call(path, "POST", {
    ...body,
    userId: actor.id,
    redirect: "/platform",
  });
  const identity = await admin.call(
    "auth/me",
    "GET",
    undefined,
    200,
    second.id,
  );
  check(
    opened.redirect === `/workspace/${second.id}/overview` &&
      identity.user.id === uid &&
      identity.user.role === "owner" &&
      identity.ghost.actorId === actor.id,
    "Server resolves owner and redirects to selected store, ignoring client identity/redirect",
  );
  await admin.call(path, "POST", body, 403);
  await admin.call("workspace/team/invite", "POST", {}, 403, second.id);
  check(true, "Store Ghost cannot nest or change team permissions");
  const [[audit]] = await db.query(
    "SELECT metadata FROM platform_audit_logs WHERE actor_id=? AND target_id=? AND action='ghost:start' ORDER BY id DESC LIMIT 1",
    [actor.id, uid],
  );
  const metadata =
    typeof audit.metadata === "string"
      ? JSON.parse(audit.metadata)
      : audit.metadata;
  check(
    metadata.storeId === second.id &&
      metadata.reason === body.reason &&
      metadata.sessionHash === hash(admin.jar.get("fleur_ghost")),
    "Store support audit preserves actor, owner, store and reason",
  );
  const stopped = await admin.call("auth/ghost/stop", "POST", {});
  check(
    stopped.redirect === "/platform/stores" &&
      (await admin.call("auth/me")).user.id === actor.id,
    "Ghost exit restores admin and returns to store list",
  );
  await admin.call(path, "POST", body);
  await db.execute(
    "UPDATE ghost_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE token_hash=?",
    [hash(admin.jar.get("fleur_ghost"))],
  );
  check(
    (await admin.call("auth/me")).user === null,
    "Expired store Ghost cannot fall back to admin",
  );
  check(
    (await admin.call("auth/ghost/stop", "POST", {})).redirect ===
      "/platform/stores",
    "Expired store Ghost can return to store list",
  );

  browser = await chromium.launch();
  await mkdir(".local/screenshots", { recursive: true });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base },
    data: { email: "owner@example.test", password: "SaaS-Testing-2026-Only" },
  });
  assert(login.ok());
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + "/platform/stores");
    await page
      .getByLabel("Tìm store", { exact: true })
      .fill("ghost-second-" + stamp);
    const row = page
      .locator("tbody tr")
      .filter({ hasText: "Store Ghost thứ hai " + stamp });
    await expect(row).toHaveCount(1);
    await row
      .getByRole("button", {
        name: "Ghost cửa hàng Store Ghost thứ hai " + stamp,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Ghost tài khoản cửa hàng",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Hồ sơ cửa hàng", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("Lý do hỗ trợ", { exact: true })
      .fill("Hỗ trợ store qua giao diện");
    await page.screenshot({
      path: `.local/screenshots/store-ghost-${width}.png`,
      fullPage: true,
    });
    const box = await dialog.boundingBox();
    check(
      box.x >= 0 && box.x + box.width <= width + 1,
      "Store Ghost dialog fits viewport at " + width,
    );
    await dialog
      .getByRole("button", { name: "Bắt đầu Ghost", exact: true })
      .click();
    await expect(page).toHaveURL(`${base}/workspace/${second.id}/overview`);
    await expect(
      page.getByRole("complementary", { name: "Phiên hỗ trợ Ghost" }),
    ).toContainText("Chủ store Ghost " + stamp);
    await page
      .getByRole("button", { name: "Quay lại admin", exact: true })
      .click();
    await expect(page).toHaveURL(base + "/platform/stores");
    await expect(page.locator(".ghost-banner")).toHaveCount(0);
    check(
      true,
      "Store action opens Ghost without row dialog and returns correctly at " +
        width,
    );
  }
  check(
    errors.length === 0,
    "No browser JavaScript errors: " + errors.join("; "),
  );
  await writeFile(
    ".local/store-ghost-fixture.json",
    JSON.stringify({ sid: second.id, firstSid: first.id, uid, stamp }),
  );
  console.log(`Store Ghost: ${passed} checks passed`);
} finally {
  await browser?.close();
  await db.end();
}
