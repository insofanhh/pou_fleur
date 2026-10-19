import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
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
  const signedIn = await (
    await context.request.get(base + "/api/auth/me", {
      headers: { "x-fleur-store": String(fixture.sid) },
    })
  ).json();
  await page.goto(base + "/workspace/" + fixture.sid + "/board");
  await page.getByRole("link", { name: "Tạo đơn hàng", exact: true }).click();
  await page
    .getByRole("heading", { name: "1. Khách hàng", exact: true })
    .waitFor();
  check(
    page.url().includes("/orders/new"),
    "Create button opens editor in current workspace",
  );
  const assignee = nativeSelect(page, "Người phụ trách");
  await expect(assignee).toHaveValue(String(signedIn.user.id));
  check(true, "New order preselects the signed-in store member as assignee");
  const paymentStatus = nativeSelect(page, "Trạng thái thanh toán");
  await expect(paymentStatus).toHaveValue("unpaid");
  await expect(paymentStatus).toBeEnabled();
  check(true, "New order starts unpaid and owner can choose payment status");
  await page
    .getByLabel("Tên người đặt", { exact: true })
    .fill("Khách UI " + Date.now());
  await page
    .getByLabel("Số điện thoại người đặt", { exact: true })
    .fill("09" + String(Date.now()).slice(-8));
  await chooseSelect(nativeSelect(page, "Kênh tiếp nhận"), "phone");
  await page.getByRole("button", { name: "Bó hoa QA", exact: false }).click();
  await page
    .getByRole("button", { name: "Thêm thiết kế riêng", exact: false })
    .click();
  await page
    .getByLabel("Tên thiết kế riêng", { exact: true })
    .fill("Bó hoa trắng UI");
  await page.getByLabel("Đơn giá (VNĐ)", { exact: true }).fill("250000");
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
  const labels = "Nhãn (phân cách bằng dấu phẩy, tối đa 6)";
  await page.getByLabel(labels, { exact: true }).fill("Khách VIP, Giao gấp");
  await page.screenshot({
    path: ".local/manual-ui/desktop-editor.png",
    fullPage: true,
  });
  const otherAssignee = await assignee
    .locator("option")
    .evaluateAll(
      (options, current) =>
        options.find((o) => o.value && o.value !== String(current)).value,
      signedIn.user.id,
    );
  await chooseSelect(assignee, otherAssignee);
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
  await expect(assignee).toHaveValue(otherAssignee);
  check(true, "Draft reload preserves a manually selected assignee");
  const received = page.getByLabel("Số tiền thực tế đã nhận (VNĐ)", {
    exact: true,
  });
  await chooseSelect(paymentStatus, "partially_paid");
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
  await chooseSelect(paymentStatus, "paid");
  await expect(received).not.toHaveValue("0");
  const originalTotal = Number(await received.inputValue());
  check(
    originalTotal === 451000,
    "Paid amount uses only product totals when delivery fee is blank",
  );
  await chooseSelect(nativeSelect(page, "Giảm giá thủ công"), "amount");
  await page.getByLabel("Giá trị giảm", { exact: true }).fill("50000");
  await page.getByLabel("Phí giao riêng (VNĐ)", { exact: true }).fill("27000");
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
  await page.getByLabel("Đơn giá (VNĐ)", { exact: true }).fill("260000");
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
  await chooseSelect(paymentStatus, "paid");
  await expect(received).toHaveValue(String(fullTotal + 10000));
  await chooseSelect(paymentStatus, "unpaid");
  await expect(received).toHaveValue("0");
  check(true, "Choosing unpaid clears a previously populated payment amount");
  await chooseSelect(paymentStatus, "partially_paid");
  await received.fill("100000");
  await chooseSelect(nativeSelect(page, "Phương thức đã nhận"), "bank");
  const reference = page.getByLabel("Mã tham chiếu / biên nhận", {
    exact: true,
  });
  await expect(reference).toHaveValue("");
  await expect(reference).not.toHaveAttribute("required");
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  await expect(paymentStatus).toHaveValue("partially_paid");
  await expect(
    page.getByRole("button", { name: "Tạo đơn hàng", exact: true }),
  ).toBeVisible();
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
    "SELECT payment_status,assigned_to,shipping,(SELECT SUM(amount) FROM order_payments WHERE order_id=o.id AND kind='collect') collected FROM orders o WHERE id=?",
    [createdId],
  );
  check(
    created.payment_status === "partially_paid" &&
      Number(created.collected) === 100000,
    "Created order payment status agrees with its actual collection ledger",
  );
  check(
    Number(created.shipping) === 27000 &&
      String(created.assigned_to) === otherAssignee,
    "Saved order retains the entered delivery fee and chosen assignee",
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
  const panel = page.getByRole("dialog");
  const panelAssignee = nativeSelect(panel, "Người phụ trách");
  await expect(panelAssignee).toBeEnabled();
  await expect(panelAssignee).toHaveValue(otherAssignee);
  check(
    await panelAssignee
      .locator("option:checked")
      .innerText()
      .then((name) => name.trim().length > 0 && !/^\d+$/.test(name.trim())),
    "Order details show the assignee name selected in the manual editor",
  );
  await expect(panel.getByLabel(labels, { exact: true })).toHaveValue(
    "Khách VIP, Giao gấp",
  );
  check(true, "Labels entered in Internal store are shown in order assignment");
  await chooseSelect(panelAssignee, String(signedIn.user.id));
  await panel.getByLabel(labels, { exact: true }).fill("Khách VIP, Sinh nhật");
  await panel
    .getByRole("button", { name: "Lưu phân công", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  const [[savedAssignment]] = await db.execute(
    "SELECT assigned_to,tags FROM orders WHERE id=?",
    [createdId],
  );
  const savedTags =
    typeof savedAssignment.tags === "string"
      ? JSON.parse(savedAssignment.tags)
      : savedAssignment.tags;
  check(
    savedAssignment.assigned_to === signedIn.user.id &&
      savedTags.join(", ") === "Khách VIP, Sinh nhật",
    "Selecting an assignee by name and editing labels updates the same stored order",
  );
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(panelAssignee).toHaveValue(String(signedIn.user.id));
  await expect(panel.getByLabel(labels, { exact: true })).toHaveValue(
    "Khách VIP, Sinh nhật",
  );
  check(
    true,
    "Reopening order details shows the latest saved assignee and labels",
  );
  await panelAssignee.locator("..").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".local/manual-ui/assignment-panel.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await chooseSelect(nativeSelect(page, "Nguồn tạo đơn"), "manual");
  await expect(page.locator(".kanban-card").first()).toBeVisible();
  await page.screenshot({
    path: ".local/manual-ui/desktop-board.png",
    fullPage: true,
  });
  for (const status of ["paid", "unpaid"]) {
    await page.goto(base + "/workspace/" + fixture.sid + "/orders/new");
    await paymentStatus.locator("..").getByRole("combobox").waitFor();
    await expect(assignee).toHaveValue(String(signedIn.user.id));
    await chooseSelect(paymentStatus, status);
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
    await page.getByLabel("Đơn giá (VNĐ)", { exact: true }).fill("300000");
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
      check(
        shipping === 0,
        "New manual orders never inherit the fixed storefront delivery fee",
      );
      const deliveryFee = page.getByLabel("Phí giao riêng (VNĐ)", {
        exact: true,
      });
      await deliveryFee.fill("45000");
      await expect(received).toHaveValue("345000");
      await deliveryFee.fill("");
      await expect(received).toHaveValue("300000");
      await deliveryFee.fill("0");
      await expect(received).toHaveValue("300000");
      check(
        true,
        "Changing, clearing, or zeroing delivery fee updates the paid amount",
      );
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
      await page.getByLabel("Đơn giá (VNĐ)", { exact: true }).fill("320000");
      await started;
      await page.getByLabel("Đơn giá (VNĐ)", { exact: true }).fill("330000");
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
      .getByLabel("Số tiền thực tế đã nhận (VNĐ)", { exact: true })
      .count()) === 0 &&
      (await nativeSelect(sp, "Giảm giá thủ công").count()) === 0,
    "Support UI hides collection and price override",
  );
  await expect(nativeSelect(sp, "Trạng thái thanh toán")).toHaveValue("unpaid");
  await expect(nativeSelect(sp, "Trạng thái thanh toán")).toBeDisabled();
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
