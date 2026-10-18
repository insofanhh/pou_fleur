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
  await expect(paymentStatus).toHaveValue("Chưa thanh toán");
  await expect(paymentStatus).toHaveJSProperty("readOnly", true);
  check(
    true,
    "New order starts unpaid with status derived from received money",
  );
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
  await page
    .getByLabel("Số tiền thực tế đã nhận (đ)", { exact: true })
    .fill("100000");
  await expect(paymentStatus).toHaveValue("Chờ tính giá");
  const quoteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspace/manual-orders/quote") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  const quoted = await (await quoteResponse).json();
  await page
    .getByRole("heading", { name: "Rà soát đơn hàng", exact: true })
    .waitFor();
  await expect(paymentStatus).toHaveValue("Thu một phần");
  check(true, "Partial receipt is classified against server-calculated total");
  await page
    .getByLabel("Số tiền thực tế đã nhận (đ)", { exact: true })
    .fill(String(quoted.total));
  await expect(paymentStatus).toHaveValue("Chờ tính giá");
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  await expect(paymentStatus).toHaveValue("Đã thanh toán");
  check(true, "Receiving the full quoted total displays paid");
  await page
    .getByLabel("Số tiền thực tế đã nhận (đ)", { exact: true })
    .fill("0");
  await expect(paymentStatus).toHaveValue("Chưa thanh toán");
  check(true, "Clearing received money resets status to unpaid");
  await page
    .getByLabel("Số tiền thực tế đã nhận (đ)", { exact: true })
    .fill("100000");
  await page
    .getByRole("button", { name: "Tính giá & rà soát", exact: true })
    .click();
  await expect(paymentStatus).toHaveValue("Thu một phần");
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
  ).toHaveValue("Chưa thanh toán");
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
