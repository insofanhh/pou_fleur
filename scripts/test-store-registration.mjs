import assert from "node:assert/strict";
import { chromium, webkit, expect } from "@playwright/test";
import { migrateStoreRegistration } from "./store-registration-schema.mjs";

export async function testStoreRegistration({ register, createStore, client, one, db, check, origin }) {
  const owner = await register("single-store@example.test");
  const first = await createStore(owner, "single-store-qa");
  const account = await one("SELECT id FROM users WHERE email='single-store@example.test'");
  check(!(await owner.call("stores/registration")).eligible, "Existing owner is ineligible to open another store");
  await createStore(owner, "single-store-again", 1, { phone: "0987777666", status: 409 });
  check((await one("SELECT COUNT(*) n FROM stores WHERE owner_id=?", [account.id])).n === 1,
    "Second store is rejected even with a different slug and phone");

  const contact = await register("phone-conflict@example.test");
  const international = "+84 " + owner.phone.slice(1, 3) + " " + owner.phone.slice(3);
  await createStore(contact, "phone-conflict-qa", 1, { phone: international, status: 409 });
  await createStore(contact, "phone-invalid-qa", 1, { phone: "phone-invalid", status: 400 });
  check((await contact.call("stores/registration")).eligible, "A rejected attempt releases claims and leaves the account eligible");

  await db.execute("UPDATE users SET email='changed-owner@example.test',phone='0988888111' WHERE id=?", [account.id]);
  await db.execute("UPDATE stores SET phone='0988888222',status='suspended' WHERE id=?", [first.id]);
  const historical = await register("single-store@example.test");
  const blocked = await historical.call("stores/registration");
  check(!blocked.eligible && blocked.store === null, "Original email remains blocked after contact changes without disclosing another store");
  await createStore(historical, "historical-email-qa", 1, { status: 409 });
  await createStore(contact, "historical-phone-qa", 1, { phone: international, status: 409 });
  check(true, "Original phone remains reserved even after store suspension and contact changes");

  await db.execute("UPDATE stores SET status='pending' WHERE id=?", [first.id]);
  await createStore(owner, "pending-duplicate-qa", 1, { status: 409 });
  await db.execute("UPDATE stores SET status='approved' WHERE id=?", [first.id]);
  await createStore(owner, "approved-duplicate-qa", 1, { status: 409 });
  check(true, "Pending, suspended and approved stores all count toward the one-store limit");

  // A failed downstream store insert must roll back every reserved identity.
  await createStore(contact, "single-store-qa", 1, { status: 409 });
  check((await contact.call("stores/registration")).eligible, "Slug collision rolls back identity claims");
  const recovered = await createStore(contact, "phone-conflict-recovered");
  check(!!recovered.id, "Account can register successfully after a rejected submission");

  const a = await register("race-a@example.test"), b = await register("race-b@example.test");
  async function rawCreate(c, slug, phone) {
    const result = await fetch(origin + "/api/stores", {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: [...c.jar].map(([k, v]) => k + "=" + v).join("; ") },
      body: JSON.stringify({ name: "Race QA", slug, address: "12 Nguyễn Huệ, Thành phố Hồ Chí Minh", phone, plan_id: 1 }),
    });
    return { status: result.status, data: await result.json() };
  }
  let race = await Promise.all([rawCreate(a, "race-a", "0975555666"), rawCreate(b, "race-b", "+84 975 555 666")]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  check(true, "Concurrent accounts sharing a normalized phone create exactly one store");
  const same = await register("race-same@example.test");
  race = await Promise.all([rawCreate(same, "race-same-a", "0965555666"), rawCreate(same, "race-same-b", "0965555777")]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  check(true, "Concurrent submissions by one account create exactly one store");

  // Membership as staff must not be mistaken for ownership.
  const staff = await register("staff-registration@example.test");
  const staffUser = await one("SELECT id FROM users WHERE email='staff-registration@example.test'");
  await db.execute("INSERT INTO store_memberships(store_id,user_id,role,status) VALUES(?,?,'support','active')", [first.id, staffUser.id]);
  check((await staff.call("stores/registration")).eligible, "Working as staff in another store does not consume the ownership entitlement");
  await client().call("stores/registration", "GET", undefined, 401);

  const legacy = await register("legacy-registration@example.test");
  const legacyUser = await one("SELECT id FROM users WHERE email='legacy-registration@example.test'");
  await db.execute("INSERT INTO stores(slug,name,owner_id,status,phone,settings,theme) VALUES('legacy-qa','Legacy',?,'draft',?,JSON_OBJECT(),JSON_OBJECT())", [legacyUser.id, legacy.phone]);
  await migrateStoreRegistration(db);
  const before = (await one("SELECT COUNT(*) n FROM store_registration_claims")).n;
  await migrateStoreRegistration(db);
  check((await one("SELECT COUNT(*) n FROM store_registration_claims")).n === before && !(await legacy.call("stores/registration")).eligible,
    "Migration backfills legacy stores and can run repeatedly without deleting data");

  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const [c, state] of [[owner, "existing"], [historical, "contact"], [staff, "new"]]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
        await context.addCookies([...c.jar].map(([name, value]) => ({ name, value, url: origin })));
        const page = await context.newPage();
        await page.goto(origin + "/start");
        if (state === "existing") {
          await expect(page.getByRole("heading", { name: "Bạn đã có cửa hàng." })).toBeVisible();
          await expect(page.getByRole("link", { name: "Vào workspace" })).toHaveAttribute("href", "/workspace/" + first.id + "/overview");
          await expect(page.getByRole("button", { name: "Tạo cửa hàng", exact: true })).toHaveCount(0);
          await db.execute("UPDATE stores SET status='pending' WHERE id=?", [first.id]);
          await page.reload();
          await expect(page.getByRole("heading", { name: "Cửa hàng đang chờ admin platform duyệt." })).toBeVisible();
          await db.execute("UPDATE stores SET status='approved' WHERE id=?", [first.id]);
        } else if (state === "contact") {
          await expect(page.getByRole("heading", { name: "Thông tin đã được dùng để mở cửa hàng." })).toBeVisible();
          await expect(page.getByRole("button", { name: "Tạo cửa hàng", exact: true })).toHaveCount(0);
        } else {
          await expect(page.getByRole("button", { name: "Tạo cửa hàng", exact: true })).toBeEnabled();
          await expect(page.getByLabel("Điện thoại", { exact: true })).toHaveValue(c.phone);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await context.close();
      }
      check(true, engine.name() + ": existing/pending/contact-conflict/staff registration UI fits mobile");
    } finally { await browser.close(); }
  }
}
