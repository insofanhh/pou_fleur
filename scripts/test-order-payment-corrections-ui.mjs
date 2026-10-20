import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";

const origin = process.env.TEST_ORIGIN || "http://localhost:3000";
assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin), "Local UI only");
await mkdir(".local/payment-corrections", { recursive: true });
let checks = 0;
const check = (ok, text) => { assert(ok, text); checks++; console.log("PASS", text); };
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce", ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}) });
    let order = { id: 900001, store_id: 1, reference: "FL20261020BD6590C", version: 1, status: "pending", payment_status: "paid", payment_method: "cod", collected: 1187000, total: 1187000, subtotal: 1187000, shipping: 0, discount: 0, customer_name: "Khách QA", phone: "0901234567", delivery_mode: "gift", cod_payer: null, delivery_date: "2026-10-25", delivery_slot: "09:00–12:00", address: "1002 Đường Láng, Hà Nội", creation_source: "manual", items: [], tags: [] };
    let events = [], payments = [], fail = false, role = "owner";
    const patches = [], errors = [];
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let data = [], status = 200;
      if (path === "/api/auth/me") data = { user: { id: 999999, role, name: "QA", email: "qa@example.test", memberships: [] } };
      else if (path === "/api/workspace/manual-orders/900001") data = order;
      else if (path === "/api/workspace/order-list") data = { mode: "board", columns: [{ status: "pending", items: [order], page: 1, total: 1, pages: 1 }], items: [order], page: 1, total: 1, pages: 1 };
      else if (path.endsWith("/timeline")) data = { events, payments };
      else if (path.endsWith("/assignment")) data = { version: order.version, tags: [], staff: [] };
      else if (path.endsWith("/payment-status")) {
        const input = req.postDataJSON(); patches.push(input);
        if (fail) { status = 409; data = { error: "Đơn vừa thay đổi. Hãy tải lại trước khi cập nhật thanh toán." }; }
        else {
          const delta = input.totalCollected - order.collected;
          order = { ...order, version: order.version + 1, ...(input.paymentMethod ? { payment_method: input.paymentMethod } : {}), ...(input.updateBalance === false ? {} : { collected: input.totalCollected, payment_status: input.totalCollected === order.total ? "paid" : input.operation === "correction" ? input.totalCollected ? "partially_paid" : "unpaid" : delta < 0 ? input.totalCollected ? "partially_refunded" : "refunded" : "partially_paid" }) };
          if (input.updateBalance !== false && input.operation === "correction") {
            events.push({ id: events.length + 1, status: "payment_corrected", detail: input.reason, created_at: "2026-10-20 12:00:00" });
            payments.push({ id: payments.length + 1, kind: "correction", amount: delta, method: "cash", reference: "QA-CORRECTION", created_at: "2026-10-20 12:00:00" });
          }
          data = { ok: true };
        }
      } else if (path.endsWith("/payment-method")) {
        const input = req.postDataJSON(); patches.push(input);
        order = { ...order, payment_method: input.method, version: order.version + 1 };
        data = { ok: true };
      }
      await route.fulfill({ status, json: data });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/workspace/1/board?order=900001");
    const dialog = page.locator("dialog.order-panel");
    const editor = dialog.locator(".order-payment-editor");
    const save = editor.getByRole("button", { name: "Lưu thanh toán", exact: true });
    const amount = editor.getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true });
    const reason = editor.getByLabel("Lý do điều chỉnh", { exact: true });
    await expect(editor).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Lưu phương thức", exact: true })).toHaveCount(0);
    await expect(save).toHaveCount(1);
    await expect(editor.getByRole("combobox", { name: "Mục đích cập nhật", exact: true })).toHaveCount(0);
    await expect(editor.getByText("Ghi nhận thu / hoàn tiền thực tế", { exact: true })).toHaveCount(0);
    await expect(editor.getByText("Phương thức đã nhận / hoàn", { exact: true })).toHaveCount(0);
    await expect(editor.getByRole("combobox", { name: "Phương thức đã nhận / hoàn", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: "Phương thức thanh toán", exact: true })).toHaveCount(0);
    await expect(dialog.locator(".order-price-list")).not.toContainText("Thanh toán khi nhận hoa (COD)");
    await expect(dialog.locator(".cod-detail-summary")).toHaveCount(0);
    await expect(dialog.getByText("Cần xác nhận người trả tiền",{exact:true})).toHaveCount(0);
    check(true, `${engine.name()}: detail only offers payment correction; movement mode and receipt/refund method are absent`);
    await chooseSelect(nativeSelect(editor, "Trạng thái thanh toán"), "unpaid");
    await expect(amount).toHaveValue("0");
    await expect(editor.getByRole("checkbox")).toHaveCount(0);
    await expect(reason).toHaveValue("");
    await expect(reason).not.toHaveAttribute("required");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.locator(".order-overview")).toContainText("Chưa thanh toán");
    await expect(dialog.locator(".order-price-list")).toContainText("Thanh toán khi nhận hoa (COD)");
    await expect(dialog.locator(".cod-detail-summary")).toContainText("Cần xác nhận người trả tiền");
    check(patches.length === 1 && patches[0].operation === "correction" && patches[0].totalCollected === 0 && patches[0].reason === "", `${engine.name()}: mistaken paid status saves immediately with empty reason and without refund confirmation`);
    check(patches[0].paymentMethod === undefined && order.payment_method === "cod", `${engine.name()}: balance correction preserves the read-only payment method`);
    await expect(save).toBeDisabled();
    await dialog.getByText("Lịch sử đơn & giao dịch", { exact: true }).click();
    await expect(dialog.locator(".order-history")).toContainText("Sửa thanh toán ghi nhầm");
    await expect(dialog.locator(".order-history")).toContainText("Điều chỉnh ghi nhầm");
    check(true, `${engine.name()}: history labels correction separately from money movement`);
    await amount.fill("200000");
    await expect(nativeSelect(editor, "Trạng thái thanh toán")).toHaveValue("partially_paid");
    await reason.fill("Ghi nhận nhầm số tiền khách đã trả");
    await save.click();
    await expect(amount).toHaveValue("200000");
    await expect(save).toBeDisabled();
    check(patches.length === 2 && order.payment_status === "partially_paid", `${engine.name()}: correction supports partial received amounts`);
    await chooseSelect(nativeSelect(editor, "Trạng thái thanh toán"), "unpaid");
    await expect(editor.getByRole("checkbox")).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.locator(".order-overview")).toContainText("Chưa thanh toán");
    check(patches[2].operation === "correction" && order.payment_status === "unpaid" && payments.every(p => p.kind === "correction"), `${engine.name()}: reducing a mistaken balance to zero never creates a refund`);
    // Correcting an erroneous refund badge without changing the zero balance.
    order = { ...order, payment_status: "refunded" };
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(dialog.locator(".order-overview")).toContainText("Đã hoàn tiền");
    await chooseSelect(nativeSelect(editor, "Trạng thái thanh toán"), "unpaid");
    await reason.fill("Hoàn tiền đã được ghi nhận nhầm");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.locator(".order-overview")).toContainText("Chưa thanh toán");
    check(order.payment_status === "unpaid", `${engine.name()}: can correct refund classification at the same balance`);
    const receiptCount = payments.length;
    await expect(save).toBeDisabled();
    fail = true;
    await amount.fill("100000"); await reason.fill("Kiểm tra bảo vệ khi đơn vừa thay đổi");
    await save.click();
    await expect(editor.getByRole("alert")).toContainText("Đơn vừa thay đổi");
    check(order.collected === 0 && await amount.inputValue() === "100000", `${engine.name()}: conflict retains unsaved input and does not change order`);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await reason.scrollIntoViewIfNeeded();
      check(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${engine.name()}: payment form fits ${width}px`);
      await page.screenshot({ path: `.local/payment-corrections/${engine.name()}-${width}.png` });
    }
    fail = false; role = "manager";
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(dialog).toBeVisible();
    await expect(editor).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: "Phương thức thanh toán", exact: true })).toHaveCount(0);
    await expect(dialog.locator(".order-price-list")).toContainText("Thanh toán khi nhận hoa (COD)");
    check(order.payment_method === "cod" && order.collected === 0 && payments.length === receiptCount, `${engine.name()}: manager sees the payment method without any payment editing controls`);
    check(patches.filter(p => p.totalCollected !== undefined).every(p => p.operation === "correction"), `${engine.name()}: all detail balance submissions explicitly use correction`);
    check(!errors.length, `${engine.name()}: no runtime errors: ${errors.join("; ")}`);
  } finally { await browser.close(); }
}
console.log(`${checks} payment correction UI checks passed (mocked API; no real orders)`);
