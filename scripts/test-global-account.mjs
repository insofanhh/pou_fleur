import { expect } from "@playwright/test";

// Run last in the disposable onboarding database. Never removes a real store.
export async function testGlobalAccount({ db, one, check, client, pageFor, origin, owner, admin, buyer, first }) {
  const [{ DATABASE: database }] = (await db.query("SELECT DATABASE() AS `DATABASE`"))[0];
  if (!/^fleur_onboarding_qa_[a-f0-9]{12}$/.test(database))
    throw Error("Account regression requires the disposable QA database");
  await db.query("SET FOREIGN_KEY_CHECKS=0");
  try {
    await db.execute("DELETE FROM stores WHERE id=1");
  } finally {
    await db.query("SET FOREIGN_KEY_CHECKS=1");
  }
  check(!(await one("SELECT id FROM stores WHERE id=1 OR slug='fleur'")), "Regression fixture has neither store #1 nor the legacy fleur slug");

  const anon = client();
  check((await anon.call("auth/me")).user === null, "Anonymous identity works without a default store");
  await anon.call("orders", "GET", undefined, 401);
  await anon.call("account", "PATCH", {}, 401);
  const outsider = client();
  await outsider.call("auth/register", "POST", {
    name: "Khách chưa mở tiệm", email: "account-qa@example.test", password: "Account-QA-Old-2026",
  }, 200, "fleur");
  check(!!(await outsider.call("auth/me")).user, "New account registration works without a default store");
  const identity = await buyer.call("auth/me", "GET", undefined, 200, "fleur");
  check(identity.user?.email === "buyer@example.test", "Signed-in identity survives the missing legacy store header");
  const staff = await owner.call("auth/me", "GET", undefined, 200, first.id);
  check(staff.user.role === "owner", "Explicit workspace identity preserves the store owner role");
  const orders = await buyer.call("orders", "GET", undefined, 200, "fleur");
  check(orders.length > 0 && orders.every(o => o.user_id === identity.user.id && o.store_slug), "Global order history returns the buyer's own orders with store information");
  await buyer.call("account", "PATCH", {
    name: "Khách tài khoản QA", phone: "0901234000", address: "12 Phố Hoa, Hà Nội",
    birthday: null, marketing_consent: false,
  }, 200, "fleur");
  check((await buyer.call("auth/me")).user.name === "Khách tài khoản QA", "Profile saves and reloads without a default store");
  await buyer.call("account/password", "POST", { currentPassword: "incorrect", password: "Account-QA-New-2026" }, 400);
  await buyer.call("platform/users", "GET", undefined, 403);
  await outsider.call("admin/products", "GET", undefined, 403, first.id);
  await buyer.call("orders/999999999/cancel", "POST", {}, 404);
  await buyer.call("orders/999999999/reorder", "POST", {}, 409);
  check(true, "Account, platform and order ownership guards remain enforced");
  await outsider.call("account/password", "POST", { currentPassword: "Account-QA-Old-2026", password: "Account-QA-New-2026" });
  await outsider.call("auth/logout", "POST", {});
  await outsider.call("auth/login", "POST", { email: "account-qa@example.test", password: "Account-QA-New-2026" });
  check(!!(await outsider.call("auth/me")).user, "Password change and re-login work without a default store");
  await admin.call("platform/config");
  await anon.call("billing/plans");
  await owner.call("stores/mine");
  check(true, "Platform configuration and onboarding APIs work without store #1");

  const guestPage = await pageFor(anon);
  for (const path of ["/account", "/account/orders", "/login", "/register", "/forgot-password", "/reset-password", "/cart", "/start"]) {
    const response = await guestPage.goto(origin + path);
    check(response.status() === 200, `${path} renders without the default store (including metadata)`);
  }
  await guestPage.goto(origin + "/account");
  await expect(guestPage.getByRole("heading", { name: "Một góc nhỏ của riêng bạn." })).toBeVisible();
  const login = client();
  await login.call("auth/login", "POST", { email: "buyer@example.test", password: "Onboarding-QA-2026-Only" }, 200, "fleur");
  check((await login.call("auth/me")).user?.id === identity.user.id, "Password login succeeds without a default store");
  const page = await pageFor(buyer, 390);
  const identityHeaders = [];
  page.on("request", r => { if (new URL(r.url()).pathname === "/api/auth/me") identityHeaders.push(r.headers()["x-fleur-store"]); });
  await page.goto(origin + "/account");
  await expect(page.getByRole("heading", { name: "Thông tin cá nhân", exact: true })).toBeVisible();
  await page.goto(origin + "/account/orders");
  await expect(page.getByRole("heading", { name: "Đơn hàng của tôi", exact: true })).toBeVisible();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile account and direct order-history link render correctly");
  check(identityHeaders.length > 0 && identityHeaders.every(h => h === undefined), "Global account UI does not send a legacy store header");
  await login.call("auth/logout", "POST", {});
  check((await login.call("auth/me")).user === null, "Logout works without a default store");
  await guestPage.close();
  await page.close();
}
