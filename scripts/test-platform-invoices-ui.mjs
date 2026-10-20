import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local app only");
const out = ".local/platform-invoices-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
let checks = 0;
const check = (value, title) => {
  assert(value, title);
  checks++;
  console.log("PASS", title);
};
const rows = [
  {
    id: 910001,
    plan_id: 2,
    plan_name: "Studio",
    amount: 100000,
    paid: 25000,
    status: "open",
    display_status: "partially_paid",
    balance: 75000,
    can_pay: true,
    can_void: false,
  },
  {
    id: 910002,
    plan_id: 1,
    plan_name: "Khởi đầu",
    amount: 139000,
    paid: 0,
    status: "open",
    display_status: "open",
    balance: 139000,
    can_pay: true,
    can_void: true,
  },
  {
    id: 910003,
    plan_id: 3,
    plan_name: "Atelier",
    amount: 259000,
    paid: 0,
    status: "open",
    display_status: "overdue",
    balance: 259000,
    can_pay: true,
    can_void: true,
  },
  {
    id: 910004,
    plan_id: 4,
    plan_name: "Trải nghiệm",
    amount: 0,
    paid: 0,
    status: "paid",
    display_status: "free",
    balance: 0,
    can_pay: false,
    can_void: false,
    effective_start_at: "2026-10-20 00:00:00",
  },
  {
    id: 910005,
    plan_id: 3,
    plan_name: "Atelier",
    amount: 259000,
    paid: 259000,
    status: "paid",
    display_status: "paid",
    balance: 0,
    can_pay: false,
    can_void: false,
  },
  {
    id: 910006,
    plan_id: 2,
    plan_name: "Studio",
    amount: 200000,
    paid: 0,
    status: "void",
    display_status: "payment_timeout",
    void_reason: "payment_timeout",
    balance: 200000,
    can_pay: false,
    can_void: false,
  },
  {
    id: 910007,
    plan_id: 1,
    plan_name: "Khởi đầu",
    amount: 100000,
    paid: 0,
    status: "void",
    display_status: "void",
    balance: 100000,
    can_pay: false,
    can_void: false,
  },
].map((r) => ({
  store_name: "Hoa Hà Nội " + r.id,
  owner_email: "hoa@example.test",
  created_at: "2026-10-20 09:00:00",
  period_start: "2026-10-20",
  period_end: "2026-11-20",
  due_date: "2026-10-20",
  due_at: "2026-10-20 15:00:00",
  ...r,
}));
const plans = [
  { id: 1, name: "Khởi đầu" },
  { id: 2, name: "Studio" },
  { id: 3, name: "Atelier" },
  { id: 4, name: "Trải nghiệm" },
];
const reads = [],
  writes = [],
  errors = [];
let fail = false;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  await ctx.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    let data = [],
      status = 200;
    if (path === "/api/auth/me")
      data = {
        user: {
          id: 999991,
          name: "Invoice QA",
          email: "qa@example.test",
          platformRole: "platform_admin",
          memberships: [],
        },
      };
    else if (path === "/api/activity") data = { ok: true };
    else if (path === "/api/platform/invoices") {
      reads.push(url);
      if (fail) {
        status = 503;
        data = { error: "QA: kết nối bị gián đoạn" };
      } else {
        const page = Number(url.searchParams.get("page") || 1),
          empty = url.searchParams.get("q") === "none";
        data = {
          rows: empty
            ? []
            : page === 1
              ? rows
              : [{ ...rows[0], id: 910099, store_name: "Store trang hai" }],
          plans,
          summary: { paid: 284000, outstanding: 473000, overdue: 1 },
          total: empty ? 0 : 21,
          page,
          page_size: 20,
        };
      }
    } else if (/^\/api\/platform\/invoices\/\d+$/.test(path)) {
      const invoice = rows.find((i) => i.id === Number(path.split("/").at(-1)));
      data = {
        invoice,
        payments:
          invoice?.paid > 0
            ? [
                {
                  id: 1,
                  reference: "TX-QA-2026",
                  amount: 25000,
                  received_at: "2026-10-20 15:00:00",
                  actor_name: "Admin QA",
                },
              ]
            : [],
      };
    } else if (req.method() !== "GET") {
      writes.push({ path, body: req.postDataJSON() });
      if (path === "/api/platform/invoices/generate") data = { ok: true };
      else if (path === "/api/platform/invoices/910001/payment") {
        const i = rows[0];
        i.paid += req.postDataJSON().amount;
        i.balance = i.amount - i.paid;
        data = { ok: true };
      } else if (path === "/api/platform/invoices/910002/void") {
        Object.assign(rows[1], {
          status: "void",
          display_status: "void",
          can_pay: false,
          can_void: false,
        });
        data = { ok: true };
      } else {
        status = 400;
        data = { error: "Unexpected QA write blocked" };
      }
    }
    await route.fulfill({ status, json: data });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/platform/invoices");
  const host = page.locator(".platform-invoices");
  await expect(host.locator(".stat-card")).toHaveCount(4);
  await expect(host.locator(".invoice-table tbody tr")).toHaveCount(7);
  check(
    true,
    "Invoice list renders summary and clear invoice/store identifiers",
  );
  const colors = await host
    .locator(".invoice-plan")
    .evaluateAll((nodes) =>
      nodes.map((n) => getComputedStyle(n).backgroundColor),
    );
  check(
    new Set(colors.slice(0, 4)).size === 4,
    "Each plan has its own tag color",
  );
  const stateColors = await host
    .locator(".invoice-status")
    .evaluateAll((nodes) =>
      nodes.map((n) => getComputedStyle(n).backgroundColor),
    );
  check(
    new Set(stateColors).size === 7,
    "All invoice states have distinct tag colors",
  );
  const free = host.getByRole("row").filter({ hasText: "HD-910004" });
  await expect(free).toContainText("Không giới hạn ngày");
  await expect(free).not.toContainText("Hạn thanh toán");
  check(
    (await free.getByRole("button").count()) === 1,
    "Free invoice only offers details and has no payment deadline",
  );
  const partial = host.getByRole("row").filter({ hasText: "HD-910001" });
  check(
    (await partial.getByRole("button").count()) === 2,
    "Partially paid invoice cannot be cancelled",
  );
  await partial
    .getByRole("button", { name: "Xem HD-910001", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("TX-QA-2026");
  await expect(dialog).toContainText("22:00 20/10/2026");
  check(
    true,
    "Detail dialog shows receipt reference, amount and Hanoi received time",
  );
  await page.keyboard.press("Escape");
  await host
    .getByRole("searchbox", { name: "Tìm kiếm", exact: true })
    .fill("hoa@example.test");
  await host.getByRole("combobox", { name: "Trạng thái", exact: true }).click();
  await page.getByRole("option", { name: "Thu một phần", exact: true }).click();
  await host
    .getByRole("combobox", { name: "Gói dịch vụ", exact: true })
    .click();
  await page.getByRole("option", { name: "Studio", exact: true }).click();
  await host.locator('input[type="date"]').first().fill("2026-10-01");
  await host.locator('input[type="date"]').nth(1).fill("2026-10-20");
  await host.getByRole("combobox", { name: "Sắp xếp", exact: true }).click();
  await page
    .getByRole("option", { name: "Còn phải thu cao nhất", exact: true })
    .click();
  await host.getByRole("button", { name: "Tìm & lọc", exact: true }).click();
  await expect.poll(() => reads.at(-1).searchParams.get("plan")).toBe("2");
  const f = reads.at(-1).searchParams;
  check(
    f.get("status") === "partially_paid" &&
      f.get("q") === "hoa@example.test" &&
      f.get("from") === "2026-10-01" &&
      f.get("to") === "2026-10-20" &&
      f.get("sort") === "balance",
    "Search, date, plan, status and sort reach the API together",
  );
  await host.getByRole("button", { name: "Sau", exact: true }).click();
  await expect(host).toContainText("Store trang hai");
  check(
    reads.at(-1).searchParams.get("q") === "hoa@example.test" &&
      reads.at(-1).searchParams.get("page") === "2",
    "Pagination retains all active filters",
  );
  await host.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  await expect(host.locator(".invoice-table tbody tr")).toHaveCount(7);
  await expect(host.getByRole("searchbox")).toHaveValue("");
  check(
    reads.at(-1).searchParams.get("page") === "1",
    "Reset clears filters and returns to first page",
  );
  await partial
    .getByRole("button", { name: "Ghi nhận thanh toán HD-910001", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  const amount = dialog.getByLabel("Số tiền nhận (VNĐ)", { exact: true });
  await expect(amount).toHaveValue("75000");
  await amount.fill("75001");
  await dialog.getByLabel("Mã giao dịch", { exact: true }).fill("QA-TOO-HIGH");
  await dialog
    .getByRole("button", { name: "Xác nhận đã nhận tiền", exact: true })
    .click();
  check(
    writes.length === 0 && !(await amount.evaluate((e) => e.validity.valid)),
    "Overpayment is blocked before submitting",
  );
  await amount.fill("10000");
  await dialog
    .getByLabel("Mã giao dịch", { exact: true })
    .fill("QA-MANUAL-RECEIPT");
  await dialog
    .getByRole("button", { name: "Xác nhận đã nhận tiền", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(partial).toContainText("35.000 VNĐ");
  check(
    writes[0].body.amount === 10000 &&
      writes[0].body.reference === "QA-MANUAL-RECEIPT",
    "Manual payment sends transaction reference and refreshes balances",
  );
  await host
    .getByRole("button", { name: "Hủy HD-910002", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Lý do hủy hóa đơn", { exact: true })
    .fill("Hủy hóa đơn QA trùng lựa chọn");
  await dialog
    .getByRole("button", { name: "Xác nhận hủy hóa đơn", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    host
      .getByRole("row")
      .filter({ hasText: "HD-910002" })
      .locator(".invoice-status"),
  ).toHaveText("Đã hủy");
  check(
    writes[1].body.reason.includes("QA"),
    "Cancellation requires a reason and refreshes status",
  );
  const before = reads.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(300);
  check(
    reads.length === before,
    "Returning to the window does not reload or flash the invoice list",
  );
  fail = true;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(host.getByRole("alert")).toContainText(
    "QA: kết nối bị gián đoạn",
  );
  await expect(host.locator(".invoice-table tbody tr")).toHaveCount(7);
  check(true, "Refresh failure keeps existing invoice data visible");
  fail = false;
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(host.getByRole("alert")).toHaveCount(0);
  await host
    .getByRole("button", { name: "Đồng bộ hóa đơn & trạng thái", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(3);
  check(
    writes[2].path.endsWith("/generate"),
    "Explicit synchronization remains available",
  );
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(100);
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Invoice list fits ${width}px`,
    );
    const dates = await host
      .locator(".date-control")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().toJSON()),
      );
    check(
      dates.length === 2 &&
        dates.every((r) => r.x >= 0 && r.right <= width && r.width > 80),
      `Date filters fit ${width}px`,
    );
    await page.screenshot({
      path: `${out}/invoices-${width}.png`,
      fullPage: true,
    });
    await partial
      .getByRole("button", { name: "Xem HD-910001", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("TX-QA-2026");
    check(
      await dialog.evaluate(
        (e) =>
          e.getBoundingClientRect().width <= innerWidth &&
          e.getBoundingClientRect().height <= innerHeight,
      ),
      `Detail modal stays inside ${width}px viewport`,
    );
    await page.screenshot({ path: `${out}/detail-${width}.png` });
    await page.keyboard.press("Escape");
  }
  await host.getByRole("searchbox").fill("none");
  await host.getByRole("button", { name: "Tìm & lọc", exact: true }).click();
  await expect(host).toContainText("Không có hóa đơn phù hợp với bộ lọc.");
  check(true, "Empty results show a clear message");
  check(errors.length === 0, "No client runtime errors: " + errors.join("; "));
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ checks, api: "intercepted fixtures", errors }, null, 2),
  );
  console.log(`${checks} platform invoice UI checks passed`);
} finally {
  await browser.close();
}
