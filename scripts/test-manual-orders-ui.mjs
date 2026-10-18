import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import mysql from "mysql2/promise";
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3006";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated DB");
const fixture = JSON.parse(
  readFileSync(".local/manual-test-fixture.json", "utf8"),
);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
});
await db.execute("DELETE FROM login_attempts");
const browser = await chromium.launch({ headless: true });
let passed = 0;
const check = (value, label) => {
  assert(value, label);
  passed++;
  console.log("PASS", label);
};
mkdirSync(".local/manual-ui", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base, "x-fleur-store": String(fixture.sid) },
    data: { email: "owner@example.test", password: "SaaS-Testing-2026-Only" },
  });
  assert(login.ok());
  await page.goto(base + "/workspace/" + fixture.sid + "/board");
  await page.getByRole("link", { name: "Tạo đơn hàng", exact: true }).click();
  await page
    .getByRole("heading", { name: "1. Khách hàng", exact: true })
    .waitFor();
  check(
    page.url().includes("/orders/new"),
    "Create button opens editor in current workspace",
  );
  const paymentStatus = page.getByLabel("Trạng thái thanh toán", {
    exact: true,
  });
  await expect(paymentStatus).toHaveValue("unpaid");
  await expect(paymentStatus).toBeEnabled();
  check(true, "New order starts unpaid and owner can choose payment status");
  await page
    .getByLabel("Tên người đặt", { exact: true })
    .fill("Khách UI " + Date.now());
  await page
    .getByLabel("Số điện thoại người đặt", { exact: true })
    .fill("09" + String(Date.now()).slice(-8));
  await page
    .getByLabel("Kênh tiếp nhận", { exact: true })
    .selectOption("phone");
  await page.getByRole("button", { name: "Bó hoa QA", exact: false }).click();
  await page
    .getByRole("button", { name: "Thêm thiết kế riêng", exact: false })
    .click();
  await page
    .getByLabel("Tên thiết kế riêng", { exact: true })
    .fill("Bó hoa trắng UI");
  await page.getByLabel("Đơn giá (đ)", { exact: true }).fill("250000");
  const upload = page.getByLabel("Ảnh tham khảo (tùy chọn)", { exact: true });
  let uploadRequests = 0;
  await page.route("**/api/upload?purpose=order-reference", async (route) => {
    uploadRequests++;
    assert.equal(
      route.request().headers()["x-fleur-store"],
      String(fixture.sid),
    );
    await route.fulfill({ json: { url: "/favicon.ico" } });
  });
  await upload.setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(
    page.getByText("Ảnh JPG, PNG hoặc WebP tối đa 4 MB.", { exact: true }),
  ).toBeVisible();
  check(uploadRequests === 0, "Invalid reference file rejected before upload");
  const image = {
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=",
      "base64",
    ),
  };
  await upload.setInputFiles(image);
  await expect(
    page.getByAltText("Ảnh tham khảo thiết kế", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xóa ảnh tham khảo", exact: true })
    .click();
  await expect(
    page.getByAltText("Ảnh tham khảo thiết kế", { exact: true }),
  ).toHaveCount(0);
  await upload.setInputFiles(image);
  await expect(
    page.getByAltText("Ảnh tham khảo thiết kế", { exact: true }),
  ).toBeVisible();
  check(
    uploadRequests === 2,
    "Reference image previews, removes, and accepts the same file again",
  );
  await page
    .getByRole("button", { name: "Xóa ảnh tham khảo", exact: true })
    .click();
  await page.unroute("**/api/upload?purpose=order-reference");
  await page.getByLabel("Giao cho khách", { exact: true }).check();
  check(
    (await page.getByLabel("Tên người nhận", { exact: true }).count()) === 0,
    "Self delivery hides repeated recipient inputs",
  );
  await page
    .getByLabel("Ngày giao hoa", { exact: true })
    .fill(fixture.tomorrow);
  await page
    .getByLabel("Địa chỉ giao hoa", { exact: true })
    .fill("123 Đường Hoa, Thành phố Hồ Chí Minh");
  await page
    .getByLabel("Lời nhắn trên thiệp (tùy chọn)", { exact: true })
    .fill("Một ngày thật đẹp!");
  await page
    .getByLabel("Ghi chú nội bộ — khách không nhìn thấy", { exact: true })
    .fill("Chuẩn bị giấy trắng");
  await page.screenshot({
    path: ".local/manual-ui/desktop-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(page).toHaveURL(/draft=\d+/);
  await page
    .getByRole("heading", { name: "1. Khách hàng", exact: true })
    .waitFor();
  check(
    (
      await page.getByLabel("Tên người đặt", { exact: true }).inputValue()
    ).startsWith("Khách UI"),
    "Draft reload preserves customer and form",
  );
  const received = page.getByLabel("Số tiền thực tế đã nhận (đ)", {
    exact: true,
  });
  await paymentStatus.selectOption("partially_paid");
  await expect(received).toHaveValue("");
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  check(
    (await received.evaluate((el) => el.validity.valueMissing)) &&
      (await page
        .getByRole("heading", { name: "Rà soát đơn hàng", exact: true })
        .count()) === 0,
    "Choosing partial payment requires entering a positive amount before review",
  );
  await paymentStatus.selectOption("paid");
  await expect(received).not.toHaveValue("0");
  const originalTotal = Number(await received.inputValue());
  check(
    originalTotal > 250000,
    "Choosing paid automatically fills the server total before review",
  );
  await page
    .getByLabel("Giảm giá thủ công", { exact: true })
    .selectOption("amount");
  await page.getByLabel("Giá trị giảm", { exact: true }).fill("50000");
  await page
    .getByLabel("Phí giao riêng (đ, bỏ trống để tự tính)", { exact: true })
    .fill("27000");
  const reason = page.getByLabel("Lý do giảm giá / sửa phí giao", {
    exact: true,
  });
  await expect(reason).toHaveValue("");
  await expect(reason).not.toHaveAttribute("required");
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Rà soát đơn hàng", exact: true })
    .waitFor();
  const summary = page.locator(".manual-summary");
  const totals = await summary.locator(".manual-total strong").innerText();
  const fullTotal = Number(totals.replace(/\D/g, ""));
  await expect(received).toHaveValue(String(fullTotal));
  await expect(paymentStatus).toHaveValue("paid");
  check(
    fullTotal > 0 &&
      (await summary
        .innerText()
        .then((s) => s.includes("50.000") && s.includes("27.000"))),
    "Paid review accepts blank adjustment reason and uses discounted total including shipping",
  );
  await page.getByLabel("Đơn giá (đ)", { exact: true }).fill("260000");
  await expect(received).toHaveValue(String(fullTotal + 10000));
  await expect(paymentStatus).toHaveValue("paid");
  check(
    true,
    "Selected paid amount follows subsequent price changes automatically",
  );
  await received.fill("100000");
  await expect(paymentStatus).toHaveValue("partially_paid");
  await received.fill(String(fullTotal + 10000));
  await expect(paymentStatus).toHaveValue("paid");
  await received.fill("0");
  await expect(paymentStatus).toHaveValue("unpaid");
  check(
    true,
    "Direct amount entry automatically resolves partial, paid, and unpaid",
  );
  await paymentStatus.selectOption("paid");
  await expect(received).toHaveValue(String(fullTotal + 10000));
  await paymentStatus.selectOption("unpaid");
  await expect(received).toHaveValue("0");
  check(true, "Choosing unpaid clears a previously populated payment amount");
  await paymentStatus.selectOption("partially_paid");
  await received.fill("100000");
  await page
    .getByLabel("Phương thức đã nhận", { exact: true })
    .selectOption("bank");
  const reference = page.getByLabel("Mã tham chiếu / biên nhận", {
    exact: true,
  });
  await expect(reference).toHaveValue("");
  await expect(reference).not.toHaveAttribute("required");
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  await expect(paymentStatus).toHaveValue("partially_paid");
  check(
    (await page
      .getByRole("button", { name: "Tạo đơn hàng", exact: true })
      .count()) === 1,
    "Review precedes final creation",
  );
  await page.screenshot({
    path: ".local/manual-ui/desktop-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tạo đơn hàng", exact: true }).click();
  await expect(page).toHaveURL(/board\?order=\d+/);
  await page.getByRole("dialog").waitFor();
  await expect(page.getByRole("dialog")).toContainText("Chuẩn bị giấy trắng");
  await expect(page.getByRole("dialog")).toContainText("100.000");
  const createdId = Number(new URL(page.url()).searchParams.get("order"));
  const [[created]] = await db.execute(
    "SELECT payment_status,(SELECT SUM(amount) FROM order_payments WHERE order_id=o.id AND kind='collect') collected FROM orders o WHERE id=?",
    [createdId],
  );
  check(
    created.payment_status === "partially_paid" &&
      Number(created.collected) === 100000,
    "Created order payment status agrees with its actual collection ledger",
  );
  const [[receipt]] = await db.execute(
    "SELECT p.reference,p.method,o.reference order_reference,o.adjustment FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE o.id=?",
    [createdId],
  );
  const adjustment =
    typeof receipt.adjustment === "string"
      ? JSON.parse(receipt.adjustment)
      : receipt.adjustment;
  check(
    receipt.method === "bank" &&
      receipt.reference === "BANK-" + receipt.order_reference &&
      adjustment.reason === "",
    "UI creates a bank-paid order with auto receipt and no adjustment reason",
  );
  check(
    true,
    "Finalized draft opens order panel with deposit and internal note",
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByLabel("Nguồn tạo đơn", { exact: true })
    .selectOption("manual");
  await expect(page.locator(".kanban-card").first()).toBeVisible();
  await page.screenshot({
    path: ".local/manual-ui/desktop-board.png",
    fullPage: true,
  });
  for (const status of ["paid", "unpaid"]) {
    await page.goto(base + "/workspace/" + fixture.sid + "/orders/new");
    await paymentStatus.waitFor();
    await paymentStatus.selectOption(status);
    await expect(received).toHaveValue("0");
    await page
      .getByLabel("Tên người đặt", { exact: true })
      .fill("Khách " + status);
    await page
      .getByLabel("Số điện thoại người đặt", { exact: true })
      .fill("09" + String(Date.now()).slice(-8));
    await page
      .getByRole("button", { name: "Thêm thiết kế riêng", exact: false })
      .click();
    await page
      .getByLabel("Tên thiết kế riêng", { exact: true })
      .fill("Hoa " + status);
    await page.getByLabel("Đơn giá (đ)", { exact: true }).fill("300000");
    await page.getByLabel("Giao cho khách", { exact: true }).check();
    await page
      .getByLabel("Ngày giao hoa", { exact: true })
      .fill(fixture.tomorrow);
    await page
      .getByLabel("Địa chỉ giao hoa", { exact: true })
      .fill("123 Đường Hoa, Thành phố Hồ Chí Minh");
    if (status === "paid") {
      await expect(received).not.toHaveValue("0");
      const shipping = Number(await received.inputValue()) - 300000;
      let releaseOld, oldStarted;
      const held = new Promise((resolve) => {
        releaseOld = resolve;
      });
      const started = new Promise((resolve) => {
        oldStarted = resolve;
      });
      const quoteURL = "**/api/workspace/manual-orders/quote";
      await page.route(quoteURL, async (route) => {
        if (route.request().postDataJSON().items[0]?.price === 320000) {
          const response = await route.fetch();
          oldStarted();
          await held;
          await route.fulfill({ response });
        } else await route.continue();
      });
      await page.getByLabel("Đơn giá (đ)", { exact: true }).fill("320000");
      await started;
      await page.getByLabel("Đơn giá (đ)", { exact: true }).fill("330000");
      await expect(received).toHaveValue(String(330000 + shipping));
      const oldResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/manual-orders/quote") &&
          r.request().postDataJSON().items[0]?.price === 320000,
      );
      releaseOld();
      await (await oldResponse).finished();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(received).toHaveValue(String(330000 + shipping));
      await page.unroute(quoteURL);
      check(
        true,
        "Late pricing responses cannot overwrite the latest full-payment amount",
      );
      await page
        .getByLabel("Mã khuyến mãi", { exact: true })
        .fill("NONEXISTENT-PAYMENT-QA");
      await expect(page.getByText(/Chưa tính được tổng đơn:/)).toBeVisible();
      await expect(received).toHaveValue("0");
      await expect(paymentStatus).toHaveValue("paid");
      await page
        .getByRole("button", { name: "Tính giá & rà soát", exact: true })
        .click();
      await expect(page.locator(".manual-error")).toBeVisible();
      check(
        (await page
          .getByRole("button", { name: "Tạo đơn hàng", exact: true })
          .count()) === 0,
        "Invalid pricing clears stale paid amount and blocks creation",
      );
      await page.getByLabel("Mã khuyến mãi", { exact: true }).fill("");
      await expect(received).toHaveValue(String(330000 + shipping));
    }
    await page
      .getByRole("button", { name: "Tính giá & rà soát", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Rà soát đơn hàng", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Tạo đơn hàng", exact: true })
      .click();
    await expect(page).toHaveURL(/board\?order=\d+/);
    const orderId = Number(new URL(page.url()).searchParams.get("order"));
    const [[order]] = await db.execute(
      "SELECT total,payment_status,COALESCE((SELECT SUM(amount) FROM order_payments WHERE order_id=o.id AND kind='collect'),0) collected FROM orders o WHERE id=?",
      [orderId],
    );
    check(
      order.payment_status === status &&
        Number(order.collected) ===
          (status === "paid" ? Number(order.total) : 0),
      "Selecting " +
        status +
        " creates the matching order status and payment ledger",
    );
    if (status === "paid") {
      const [[cash]] = await db.execute(
        "SELECT p.reference,p.method,o.reference order_reference FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE o.id=?",
        [orderId],
      );
      check(
        cash.method === "cash" &&
          cash.reference === "CASH-" + cash.order_reference,
        "Cash payment continues generating an internal receipt automatically",
      );
    }
  }
  await page.goto(base + "/workspace/" + fixture.sid + "/orders/new?drafts=1");
  await page.getByRole("heading", { name: "Đơn nháp", exact: true }).waitFor();
  check(
    (await page.getByRole("link", { name: "Mở nháp", exact: true }).count()) >
      0,
    "Draft list remains accessible",
  );
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + "/workspace/" + fixture.sid + "/orders/new");
    await page
      .getByRole("heading", { name: "1. Khách hàng", exact: true })
      .waitFor();
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "No mobile horizontal overflow at " + width,
    );
    await page
      .getByRole("button", { name: "Thêm thiết kế riêng", exact: false })
      .click();
    await page
      .getByLabel("Tên thiết kế riêng", { exact: true })
      .fill("Hoa mobile");
    check(
      await page.getByLabel("Tên người nhận", { exact: true }).isVisible(),
      "Gift recipient shown by default at " + width,
    );
    await expect(
      page.getByLabel("Gửi hoa tới người khách thương", { exact: true }),
    ).toBeChecked();
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Upload and delivery labels fit mobile at " + width,
    );
    await page
      .getByLabel("Ngày giao hoa", { exact: true })
      .scrollIntoViewIfNeeded();
    const day = await page
      .getByLabel("Ngày giao hoa", { exact: true })
      .boundingBox();
    const slot = await page
      .getByLabel("Khung giờ", { exact: true })
      .boundingBox();
    check(
      day && slot && slot.y >= day.y + day.height,
      "Delivery date and slot do not overlap at " + width,
    );
    await page.screenshot({
      path: ".local/manual-ui/mobile-" + width + ".png",
      fullPage: true,
    });
    page.once("dialog", (d) => d.accept());
    await page
      .locator(".manual-nav")
      .getByRole("link", { name: "Đơn hàng", exact: true })
      .click();
  }
  const supportContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await supportContext.request.post(base + "/api/auth/login", {
    headers: { origin: base, "x-fleur-store": String(fixture.sid) },
    data: { email: fixture.supportEmail, password: "SaaS-Testing-2026-Only" },
  });
  const sp = await supportContext.newPage();
  await sp.goto(base + "/workspace/" + fixture.sid + "/orders/new");
  await sp
    .getByRole("heading", { name: "1. Khách hàng", exact: true })
    .waitFor();
  check(
    (await sp
      .getByLabel("Số tiền thực tế đã nhận (đ)", { exact: true })
      .count()) === 0 &&
      (await sp.getByLabel("Giảm giá thủ công", { exact: true }).count()) === 0,
    "Support UI hides collection and price override",
  );
  await expect(
    sp.getByLabel("Trạng thái thanh toán", { exact: true }),
  ).toHaveValue("unpaid");
  await expect(
    sp.getByLabel("Trạng thái thanh toán", { exact: true }),
  ).toBeDisabled();
  await sp.screenshot({
    path: ".local/manual-ui/mobile-support.png",
    fullPage: true,
  });
  check(
    errors.length === 0,
    "No browser JavaScript errors: " + errors.join("; "),
  );
  console.log("Manual order UI checks passed: " + passed);
} finally {
  await browser.close();
  await db.end();
}
