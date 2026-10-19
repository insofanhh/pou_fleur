import assert from "node:assert/strict";
import { chromium, webkit, expect as playwrightExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Read-only presentation checks: all APIs are intercepted, including quote previews.
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const expect = playwrightExpect.configure({ timeout: 15000 });
const settings = {
  shipping: 0,
  free_shipping: 0,
  lead_minutes: 60,
  advance_days: 89,
  capacity: 10,
  slots: ["09:00–12:00", "12:00–15:00"],
  closed_dates: [],
  open: true,
};
const sampleOrder = {
  id: 900000,
  reference: "UI-ONLY",
  customer_name: "Khách kiểm tra",
  recipient_name: "Người nhận",
  recipient_phone: "0901234567",
  phone: "0901234567",
  email: "ui@example.test",
  creation_source: "manual",
  sales_channel: "phone",
  delivery_date: "2026-10-25",
  delivery_slot: settings.slots[0],
  address: "123 Đường Hoa",
  total: 1191000,
  subtotal: 1191000,
  payment_status: "unpaid",
  payment_method: "cod",
  status: "pending",
  version: 1,
  items: [],
  tags: [],
};
await mkdir(".local/screenshots", { recursive: true });

for (const browserType of process.argv.includes("--webkit")
  ? [webkit]
  : [chromium]) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
      ...(browserType === webkit ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage(),
      errors = [],
      unexpectedWrites = [];
    let signedIn = true;
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname;
      let data = [];
      if (req.method() !== "GET") {
        if (p === "/api/workspace/manual-orders/quote")
          data = {
            total: 100000,
            subtotal: 100000,
            shipping: 0,
            discount: 0,
            adjustment: 0,
            items: [],
          };
        else {
          unexpectedWrites.push(p);
          await route.fulfill({
            status: 400,
            json: { error: "Read-only UI verification" },
          });
          return;
        }
      } else if (p === "/api/auth/me")
        data = {
          user: signedIn
            ? {
                id: 999999,
                name: "UI QA",
                email: "ui@example.test",
                role: "owner",
                platformRole: "platform_admin",
                memberships: [],
              }
            : null,
          ghost: null,
        };
      else if (p.endsWith("/notifications")) data = { items: [] };
      else if (p === "/api/workspace/order-list")
        data =
          url.searchParams.get("mode") === "table"
            ? { items: [sampleOrder], total: 1, page: 1, limit: 20 }
            : {
                columns: [
                  {
                    status: "pending",
                    items: [sampleOrder],
                    total: 1,
                    page: 1,
                    limit: 20,
                  },
                ],
              };
      else if (p.endsWith("/timeline")) data = { events: [], payments: [] };
      else if (p.endsWith("/assignment"))
        data = {
          staff: [{ id: 999999, name: "UI QA" }],
          tags: [],
          assigned_to: 999999,
          version: 1,
        };
      else if (p === "/api/workspace/manual-orders/options")
        data = {
          settings,
          capabilities: {
            create: true,
            collect: true,
            adjust: true,
            confirm: true,
          },
          currentUserId: 999999,
          staff: [{ id: 999999, name: "UI QA" }],
          requiresCoordinates: false,
        };
      else if (p === "/api/workspace/settings")
        data = {
          id: 1,
          version: 1,
          name: "UI Store",
          phone: "0901234567",
          address: "123 Đường Hoa",
          status: "approved",
          settings,
          radius_km: 10,
          bank: { auto_confirm_status: "confirmed" },
        };
      else if (p === "/api/admin/overview")
        data = { stats: {}, revenue: [], recent: [], top: [] };
      else if (p === "/api/admin/product-taxonomy")
        data = { categories: [{ id: 900001, name: "Danh mục kiểm tra" }], components: [] };
      else if (p === "/api/workspace/calendar")
        data = { orders: [], notes: [] };
      else if (p === "/api/platform/users")
        data = { users: [], page: 1, pages: 1, total: 0 };
      else if (p === "/api/platform/stores") data = [];
      await route.fulfill({ status: 200, json: data });
    });
    async function inspect(label, width) {
      const bad = await page
        .locator(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]):not([type="range"]),.ui-select-trigger',
        )
        .evaluateAll(
          (elements, width) =>
            elements
              .filter(
                (el) =>
                  el.getClientRects().length &&
                  getComputedStyle(el).visibility !== "hidden",
              )
              .flatMap((el) => {
                const r = el.getBoundingClientRect(),
                  s = getComputedStyle(el),
                  height = width <= 700 ? 44 : 40;
                const expected = el.closest(".search-field,.location-search,.date-control")
                  ? height - 2
                  : height;
                return Math.abs(r.height - expected) > 1 ||
                  r.width > innerWidth ||
                  r.left < -1 ||
                  r.right > innerWidth + 1 ||
                  parseFloat(s.fontSize) !== (width <= 700 ? 16 : 13)
                  ? [
                      {
                        name:
                          el.getAttribute("aria-label") ||
                          el.getAttribute("name") ||
                          el.className,
                        width: r.width,
                        left: r.left,
                        right: r.right,
                        height: r.height,
                        font: s.fontSize,
                        expected,
                      },
                    ]
                  : [];
              }),
          width,
        );
      assert.deepEqual(
        bad,
        [],
        label + " input dimensions / mobile containment",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        label + " page must not overflow",
      );
    }
    async function choose(label, option) {
      const trigger = page.getByRole("combobox", { name: label, exact: true });
      await trigger.click();
      const menu = page.getByRole("listbox", { name: label, exact: true });
      await expect(menu).toBeVisible();
      const rect = await menu.boundingBox(),
        viewport = page.viewportSize();
      assert(
        rect.x >= 0 && rect.x + rect.width <= viewport.width + 1,
        "Popup must fit viewport",
      );
      await menu.getByRole("option", { name: option, exact: true }).click();
      await expect(trigger).toContainText(option);
      await expect(menu).toHaveCount(0);
      return trigger;
    }
    for (const width of browserType === webkit
      ? [390, 320]
      : [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + "/admin/board");
      await expect(page.locator(".kanban-card")).toHaveCount(1);
      await inspect("board", width);
      assert.equal(
        await page
          .locator(".kanban-card-price")
          .evaluate((el) => getComputedStyle(el).fontSize),
        width > 1100 ? "11px" : width > 700 ? "10.5px" : "10px",
      );
      await page.locator(".kanban-card").click();
      const orderDialog = page.getByRole("dialog");
      await expect(orderDialog).toBeVisible();
      await choose("Trạng thái thanh toán", "Thanh toán một phần");
      await expect(
        page.locator('.order-payment-editor input[type="number"]'),
      ).toBeVisible();
      await page.screenshot({
        path: `.local/screenshots/controls-order-${browserType.name()}-${width}.png`,
      });
      // No submit: the order data must never be changed by UI verification.
      await page.goto(base + "/admin/orders/new");
      await expect(
        page.getByRole("heading", { name: "1. Khách hàng", exact: true }),
      ).toBeVisible();
      await inspect("manual order", width);
      await choose("Kênh tiếp nhận", "Zalo");
      await choose("Trạng thái thanh toán", "Thanh toán một phần");
      await expect(
        page.getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true }),
      ).toBeVisible();
      const fieldset = page.locator(".manual-fieldset").first();
      await fieldset.evaluate((el) => (el.disabled = true));
      await page
        .getByRole("combobox", { name: "Kênh tiếp nhận", exact: true })
        .click({ force: true });
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await fieldset.evaluate((el) => (el.disabled = false));
      await page.screenshot({
        path: `.local/screenshots/controls-manual-${browserType.name()}-${width}.png`,
      });
      await page.goto(base + "/admin/settings");
      await expect(
        page.getByRole("heading", { name: "UI Store" }),
      ).toBeVisible();
      await inspect("store settings", width);
      const trigger = await choose(
        "Trạng thái đơn sau khi nhận tiền",
        "Đang chuẩn bị",
      );
      assert.equal(
        await page
          .locator('select[name="auto_confirm_status"]')
          .evaluate((el) => new FormData(el.form).get("auto_confirm_status")),
        "preparing",
      );
      await page
        .locator('select[name="auto_confirm_status"]')
        .evaluate((el) => el.form.reset());
      await expect(trigger).toContainText("Đã xác nhận");
      await page.goto(base + "/platform/users");
      await expect(
        page.getByRole("combobox", {
          name: "Trạng thái tài khoản",
          exact: true,
        }),
      ).toBeVisible();
      await inspect("platform users", width);
      const filteredUsers = page.waitForResponse(
        (response) =>
          response.url().includes("/api/platform/users?") &&
          new URL(response.url()).searchParams.get("state") === "active",
      );
      await choose("Trạng thái tài khoản", "Đang hoạt động");
      await (await filteredUsers).finished();
      await page
        .getByRole("button", { name: "Thêm tài khoản", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Thêm tài khoản" }),
      ).toBeVisible();
      await inspect("platform account modal", width);
      await page.goto(base + "/admin/products");
      await page
        .getByRole("button", { name: "Thêm sản phẩm", exact: true })
        .click();
      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await inspect("product modal", width);
      // Taxonomy controls are inside a native showModal dialog.
      const select = modal.locator(".ui-select").first();
      const combo = select.getByRole("combobox");
      await combo.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      const item = page.getByRole("listbox").getByRole("option", { name: "Danh mục kiểm tra", exact: true });
      const label = await item.innerText();
      await item.click();
      await expect(combo).toContainText(label);
      // A required native select must block submission and focus the visible control.
      await select.locator("select").evaluate((el) => {
        el.required = true;
        const option = new Option("Chọn giá trị", "");
        el.prepend(option);
        el.value = "";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.checkValidity();
      });
      await expect(combo).toHaveAttribute("aria-invalid", "true");
      await expect(combo).toBeFocused();
      await expect(select.getByRole("alert")).toBeVisible();
      await page.screenshot({
        path: `.local/screenshots/controls-product-${browserType.name()}-${width}.png`,
      });
      await page.goto(base + "/s/fleur/shop");
      await expect(
        page.getByRole("combobox", { name: "Dịp tặng hoa", exact: true }),
      ).toBeVisible();
      await inspect("shop", width);
      await choose("Dịp tặng hoa", "Sinh nhật");
      await choose("Sắp xếp", "Giá giảm dần");
      console.log(
        `PASS ${browserType.name()} ${width}: board prices, order payment, manual order, disabled fieldset, settings FormData/reset, platform, native modal dropdown/validation, storefront`,
      );
    }
    signedIn = false;
    await page.goto(base + "/login");
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await inspect("login", page.viewportSize().width);
    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${browserType.name()}: authentication inputs, no browser errors; all API requests intercepted, no database writes or mail`,
    );
  } finally {
    await browser.close();
  }
}
