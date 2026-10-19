import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const expect = baseExpect.configure({ timeout: 20000 });
await mkdir(".local/screenshots", { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const kind of ["store", "platform"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const page = await context.newPage(),
        errors = [],
        mutations = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route("**/api/**", async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname;
        if (req.method() !== "GET") mutations.push(path);
        let data = [];
        if (path === "/api/auth/me")
          data = {
            user: {
              id: 999999,
              name: "Sidebar QA",
              email: "qa@example.test",
              role: "owner",
              platformRole: "platform_admin",
              memberships: [],
            },
            ghost: null,
          };
        else if (path.endsWith("/notifications")) data = { items: [] };
        await route.fulfill({ json: data });
      });
      const base = kind === "store" ? "/admin" : "/platform";
      const initial = kind === "store" ? "products" : "stores";
      const nextName = kind === "store" ? "Tin tức" : "Hóa đơn dịch vụ";
      const nextPath = kind === "store" ? "posts" : "invoices";
      await page.goto(origin + base + "/" + initial);
      const sidebar = page.locator("#dashboard-sidebar"),
        shell = page.locator(".admin-shell");
      await expect(sidebar.locator(".dashboard-wordmark")).toBeVisible();
      await expect(sidebar.locator(".dashboard-brand-mark")).toBeHidden();
      await page.evaluate(() => {
        window.qaSidebar = document.querySelector("#dashboard-sidebar");
      });
      const toggle = () =>
        page.getByRole("button", { name: "Thu gọn thanh menu", exact: true });
      const expand = () =>
        page.getByRole("button", { name: "Mở rộng thanh menu", exact: true });
      await toggle().click();
      await expect(shell).toHaveClass(/sidebar-collapsed/);
      await expect(sidebar).toHaveCSS("width", "80px");
      await expect(sidebar.locator(".dashboard-wordmark")).toBeHidden();
      await expect(sidebar.locator(".dashboard-brand-mark")).toBeVisible();
      await expect(sidebar.locator(".workspace-label")).toBeHidden();
      assert.equal(
        await sidebar
          .locator(".dashboard-brand-mark")
          .evaluate((el) => el.complete && el.naturalWidth > 0),
        true,
      );
      assert.equal(
        Math.round(
          await page
            .locator(".admin-main")
            .evaluate((el) => el.getBoundingClientRect().left),
        ),
        80,
      );
      await sidebar.getByRole("link", { name: nextName, exact: true }).click();
      await expect(page).toHaveURL(origin + base + "/" + nextPath);
      await expect(sidebar).toHaveCSS("width", "80px");
      assert(
        await page.evaluate(
          () =>
            window.qaSidebar === document.querySelector("#dashboard-sidebar"),
        ),
        "Navigation preserves the sidebar",
      );
      await page.reload();
      await expect(sidebar).toHaveCSS("width", "80px");
      await expand().click();
      await expect(sidebar.locator(".dashboard-wordmark")).toBeVisible();
      await expect(sidebar.locator(".dashboard-brand-mark")).toBeHidden();
      await expect(shell).not.toHaveClass(/sidebar-collapsed/);
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 950 });
        await toggle().click();
        await expect(sidebar).toHaveCSS("width", "80px");
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: `.local/screenshots/sidebar-${engine.name()}-${kind}-${width}.png`,
          fullPage: true,
        });
        await expand().click();
      }
      // Desktop preference must never turn the mobile drawer into an icon rail.
      await toggle().click();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 950 });
        await expect.poll(() => sidebar.evaluate((el) => el.inert)).toBe(true);
        await expect(page.locator(".sidebar-collapse-toggle")).toBeHidden();
        const open = page.getByRole("button", {
          name: "Mở menu quản trị",
          exact: true,
        });
        await open.click();
        await expect(sidebar).toHaveClass(/mobile-open/);
        await expect(sidebar.locator(".dashboard-wordmark")).toBeVisible();
        await expect(sidebar.locator(".dashboard-brand-mark")).toBeHidden();
        const close = sidebar.getByRole("button", {
          name: "Đóng menu quản trị",
          exact: true,
        });
        await expect(close).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(
          sidebar.getByRole("button", { name: "Đăng xuất", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(close).toBeFocused();
        await page.screenshot({
          path: `.local/screenshots/sidebar-${engine.name()}-${kind}-${width}.png`,
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(sidebar).not.toHaveClass(/mobile-open/);
        await expect(open).toBeFocused();
        await open.click();
        await page
          .locator(".sidebar-backdrop")
          .click({ position: { x: width - 8, y: 200 } });
        await expect(sidebar).not.toHaveClass(/mobile-open/);
        await open.click();
        await close.click();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.equal(
          await page.evaluate(() => document.body.style.overflow),
          "",
        );
      }
      await page
        .getByRole("button", { name: "Mở menu quản trị", exact: true })
        .click();
      await sidebar
        .getByRole("link", {
          name: kind === "store" ? "Sản phẩm" : "Cửa hàng & Merchant CRM",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(origin + base + "/" + initial);
      await expect(sidebar).not.toHaveClass(/mobile-open/);
      await page.goto(origin + "/login");
      await expect(page.locator("header .logo")).toContainText("fleurious");
      await expect(
        page.locator(
          "header .logo img,header .logo svg,footer .logo img,footer .logo svg",
        ),
      ).toHaveCount(0);
      assert.deepEqual(errors, []);
      assert.deepEqual(mutations, []);
      console.log(
        `PASS ${engine.name()} ${kind}: collapse, icon, persistence, navigation, 1440/1024/390/320px, mobile focus/Escape/backdrop, text-only website logo`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
