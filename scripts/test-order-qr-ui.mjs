import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3005";
assert(
  ["http://127.0.0.1:3005", "http://127.0.0.1:3000"].includes(origin),
  "Local app only; all API calls intercepted",
);
await mkdir(".local/order-qr-ui", { recursive: true });
let checks = 0;
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
        ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}),
      });
      let status = "pending",
        cancels = 0;
      const errors = [],
        expiresAt = new Date(Date.now() + 300000).toISOString();
      const code = "FLR-ORD-123-A1B2C3";
      const session = () => ({
        code,
        reference: "QR-UI-QA",
        amount: 139000,
        status,
        orderStatus:
          status === "pending" || status === "paid" ? "pending" : "cancelled",
        paymentStatus: status === "paid" ? "paid" : "unpaid",
        expiresAt,
        serverNow: new Date().toISOString(),
        qrUrl:
          status === "pending"
            ? "https://img.vietqr.io/image/970423-123456789-compact2.png"
            : "",
        bank: {
          bank_name: "TPBank",
          account_number: "123456789",
          account_holder: "QA",
        },
      });
      await context.addInitScript(
        ({ code }) => {
          localStorage.removeItem("fleur.cart");
          localStorage.removeItem("fleur.cart.fleur");
          sessionStorage.setItem(
            "fleur.order-payment.fleur",
            JSON.stringify({ reference: "QR-UI-QA", code }),
          );
        },
        { code },
      );
      await context.route("https://img.vietqr.io/**", (r) =>
        r.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="300"><rect width="240" height="300" fill="#f4f4f4"/><text x="60" y="150">QR test</text></svg>',
        }),
      );
      await context.route("**/api/**", async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname;
        let data = {};
        if (path === "/api/auth/me") data = { user: null };
        else if (path === "/api/store")
          data = { name: "QR QA", settings: {}, theme: {} };
        else if (path === "/api/payment-intents") data = session();
        else if (path === "/api/payment-intents/cancel") {
          cancels++;
          status = "cancelled";
          data = session();
        } else if (req.method() !== "GET") {
          await route.fulfill({
            status: 400,
            json: { error: "Unexpected mutation" },
          });
          return;
        }
        await route.fulfill({ json: data });
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/s/fleur/checkout");
      const panel = page.getByRole("region", {
        name: "Thanh toán chuyển khoản",
      });
      await expect(panel.getByText("TPBank", { exact: false })).toBeVisible();
      await expect(panel.getByRole("img")).toHaveAttribute("src", /970423-/);
      await expect(panel.getByRole("status")).toContainText(/Còn [45]:/);
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(sessionStorage.getItem("fleur.order-payment.fleur"))
              .code,
        ),
        code,
      );
      await panel.screenshot({
        path: `.local/order-qr-ui/${engine.name()}-${width}-pending.png`,
      });
      await page.reload();
      await expect(panel.getByRole("status")).toContainText(/Còn [45]:/);
      await panel
        .getByRole("button", { name: "Hủy thanh toán", exact: true })
        .click();
      assert.equal(cancels, 0);
      await panel
        .getByRole("button", { name: "Quay lại", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Hủy thanh toán", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Xác nhận hủy", exact: true })
        .click();
      await expect(
        panel.getByText("Phiên thanh toán đã đóng", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("img")).toHaveCount(0);
      assert.equal(cancels, 1);
      status = "expired";
      await page.reload();
      await expect(
        panel.getByText("Phiên thanh toán đã đóng", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("img")).toHaveCount(0);
      status = "paid";
      await page.reload();
      await expect(
        panel.getByText("Thanh toán thành công", { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Hủy thanh toán", exact: true }),
      ).toHaveCount(0);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "No horizontal overflow",
      );
      await panel.screenshot({
        path: `.local/order-qr-ui/${engine.name()}-${width}.png`,
      });
      // WebKit reports same-origin fetches aborted by page.reload as access-control pageerrors.
      // Keep all other runtime errors fatal; every status response is asserted above.
      assert.deepEqual(
        errors.filter(
          (e) =>
            !(
              engine === webkit &&
              /api\/payment-intents.*due to access control checks\.$/.test(e)
            ),
        ),
        [],
      );
      checks++;
      console.log(
        "PASS",
        engine.name(),
        width,
        "QR bank, recovery, cancel, expiry, paid state and layout",
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
console.log(`PASS ${checks} order QR browser scenarios`);
