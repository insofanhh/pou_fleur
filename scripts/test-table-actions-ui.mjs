import assert from "node:assert/strict";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Intercept every API call: no real records, payments or email are changed.
const expect = baseExpect.configure({ timeout: 15000 });
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const today = new Date().toLocaleDateString("en-CA");
const item = {
  id: 991,
  name: "Dữ liệu QA",
  slug: "du-lieu-qa",
  description: "Thông tin kiểm tra",
  active: 1,
};
const customer = {
  ...item,
  email: "qa@example.test",
  phone: "0901234567",
  segment: "new",
  marketing_consent: 1,
  order_count: 1,
  total_spent: 150000,
};
const product = {
  ...item,
  category_id: 991,
  category: item.name,
  price: 150000,
  stock: 5,
  image: "/images/roses.jpg",
  flowers: "Hồng",
  care: "Thay nước",
  flower_component_ids: [],
};
const order = {
  ...customer,
  reference: "ACTION-QA",
  customer_name: "Khách QA",
  recipient_name: "Người nhận",
  recipient_phone: customer.phone,
  delivery_date: today,
  delivery_slot: "09:00–12:00",
  status: "pending",
  payment_status: "unpaid",
  payment_method: "cod",
  total: 150000,
  subtotal: 150000,
  version: 1,
  items: [],
  tags: [],
  address: "12 Nguyễn Huệ",
  created_at: today,
};
const invoice = {
  id: 991,
  store_name: "Cửa hàng QA",
  plan_name: "Khởi đầu",
  amount: 150000,
  paid: 0,
  status: "open",
  due_date: "2026-12-01",
  period_key: "2026-11",
  plan_id: 1,
  balance: 150000,
  can_pay: true,
  can_void: true,
};
const email = {
  configuration: { enabled: true, ready: true },
  stats: [],
  customers: [],
  templates: [
    {
      ...item,
      kind: "marketing",
      subject: "QA",
      body: "{{customer_name}}",
      variables: [],
    },
  ],
  campaigns: [{ ...item, recipient_count: 2, sent_count: 0, pending_count: 2 }],
  messages: [
    {
      id: "store-991",
      recipient: customer.email,
      subject: "Email QA",
      status: "failed",
      attempts: 1,
      created_at: today,
    },
  ],
};
await mkdir(".local/screenshots", { recursive: true });

for (const engine of process.argv.includes("--webkit") ? [webkit] : [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of engine === chromium ? [1440, 390] : [390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors = [],
        writes = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route("**/api/**", async (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        let data = [];
        if (request.method() !== "GET") {
          writes.push({
            path,
            method: request.method(),
            body: request.postDataJSON(),
          });
          data = path.includes("/message/")
            ? { subject: "Email QA", html: "<p>Email QA</p>" }
            : { ok: true };
        } else if (path === "/api/auth/me")
          data = {
            user: {
              ...customer,
              id: 999999,
              role: "owner",
              platformRole: "platform_admin",
              memberships: [],
            },
            ghost: null,
          };
        else if (path.endsWith("/notifications")) data = { items: [] };
        else if (path === "/api/admin/product-taxonomy")
          data = { categories: [item], components: [item] };
        else if (path === "/api/admin/products") data = [product];
        else if (
          ["/api/admin/categories", "/api/admin/flower_components"].includes(
            path,
          )
        )
          data = [item];
        else if (path === "/api/admin/posts")
          data = [
            {
              ...item,
              title: "Bài viết QA",
              published: 1,
              image: product.image,
              created_at: today,
            },
          ];
        else if (path === "/api/admin/events")
          data = [{ ...item, starts_at: today, ends_at: today }];
        else if (path === "/api/admin/promotions")
          data = [
            {
              ...item,
              code: "QA",
              type: "percent",
              value: 10,
              used: 0,
              usage_limit: 5,
            },
          ];
        else if (path === "/api/admin/inquiries")
          data = [
            { ...customer, status: "new", message: "Cần tư vấn" },
            { ...customer, id: 992, status: "resolved", message: "Đã hỗ trợ" },
          ];
        else if (path === "/api/admin/crm")
          data = { customers: [customer], notes: [], tasks: [], orders: [] };
        else if (path.endsWith("/emails")) data = email;
        else if (path === "/api/workspace/order-list")
          data = { items: [order], total: 1, page: 1, limit: 20 };
        else if (path.endsWith("/timeline"))
          data = { events: [], payments: [] };
        else if (path.endsWith("/assignment"))
          data = { staff: [], tags: [], version: 1 };
        else if (path === "/api/workspace/calendar")
          data = {
            orders: [],
            notes: [
              {
                ...item,
                day: today,
                title: "Ghi chú QA",
                color: "#eee",
                content: "Nội dung",
              },
            ],
          };
        else if (path === "/api/workspace/team")
          data = {
            members: [{ ...customer, role: "manager", status: "active" }],
            invitations: [],
          };
        else if (path === "/api/workspace/automations")
          data = {
            rules: [{ ...item, trigger_name: "birthday", delay_days: 1 }],
            templates: [],
          };
        else if (path === "/api/workspace/billing")
          data = {
            subscription: {
              name: "Khởi đầu",
              plan_id: 1,
              limits: {},
              monthly_price: 150000,
              status: "active",
            },
            store: { status: "approved" },
            plans: [],
            invoices: [invoice],
            usage: {},
          };
        else if (path === "/api/platform/users")
          data = {
            users: [
              { ...customer, memberships: [], active: 1, created_at: today },
            ],
            total: 1,
            pages: 1,
            page: 1,
          };
        else if (path.startsWith("/api/platform/users/"))
          data = {
            user: { ...customer, version: 1, active: 1 },
            memberships: [],
            audit: [],
          };
        else if (path === "/api/platform/stores")
          data = ["approved", "pending"].map((status, i) => ({
            ...item,
            id: item.id + i,
            status,
            name: "Store QA " + i,
            owner_email: customer.email,
            plan: "Khởi đầu",
            subscription_status: "active",
            orders_count: 1,
            gmv: 150000,
            customers: 1,
            version: 1,
          }));
        else if (path === "/api/platform/invoices") data = {rows:[invoice],summary:{paid:0,outstanding:150000,overdue:0},plans:[{id:1,name:'Khởi đầu'}],total:1,page:1,page_size:20};
        else if (path === "/api/platform/invoices/991") data = {invoice,payments:[]};
        else if (path === "/api/orders")
          data = [
            { ...order, status: "delivered", items: [] },
            { ...order, id: 992, reference: "ACTION-QA-2", items: [] },
          ];
        await route.fulfill({ status: 200, json: data });
      });
      async function inspect(label) {
        const actions = page.locator(".table-action");
        await expect(actions.first()).toBeVisible();
        const bad = await actions.evaluateAll(
          (buttons, width) =>
            buttons.flatMap((button) => {
              const icon = button.querySelector("svg"),
                style = getComputedStyle(button),
                box = button.getBoundingClientRect();
              return !icon ||
                icon.getAttribute("width") !== "15" ||
                (!button.textContent.trim() && !button.getAttribute('aria-label')) ||
                style.color !== "rgb(23, 23, 23)" ||
                box.height < (width <= 700 ? 44 : 32) - 1
                ? [button.outerHTML]
                : [];
            }),
          width,
        );
        assert.deepEqual(bad, [], label);
        for (const table of await page.locator("table").all()) {
          if (await table.locator(".table-action").count()) {
            await expect(table.locator("thead th").last()).toHaveText(
              "Thao tác",
            );
            const cells = table.locator("tbody tr td:last-child");
            assert.equal(
              await cells.locator("button:not(.table-action)").count(),
              0,
              label + " has old action buttons",
            );
          }
        }
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          label + " page overflows",
        );
      }
      async function clickAndRefresh(control, path) {
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "GET");
        await control.click();
        await (await refreshed).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      for (const area of [
        "products",
        "posts",
        "events",
        "promotions",
        "inquiries",
        "categories",
        "crm",
        "orders",
        "calendar",
        "users",
        "automations",
        "billing",
      ]) {
        await page.goto(origin + "/admin/" + area);
        await inspect("workspace/" + area);
        if (area === "categories") {
          await page
            .getByRole("tab", { name: "Thành phần hoa", exact: true })
            .click();
          await inspect("flower-components");
        }
        if (area === "posts") {
          await page
            .getByRole("button", { name: "Chỉnh sửa", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Huỷ", exact: true })
            .click();
          await page.screenshot({
            path: `.local/screenshots/actions-posts-${engine.name()}-${width}.png`,
          });
        }
        if (area === "inquiries") {
          await clickAndRefresh(page
            .getByRole("button", { name: "Đổi trạng thái hỗ trợ", exact: true })
            .first(), "/api/admin/inquiries");
          assert(
            writes.some(
              (w) =>
                w.path === "/api/admin/inquiries/991" &&
                w.body.status === "resolved",
            ),
          );
        }
        if (area === "orders") {
          await page
            .getByRole("button", { name: "Chi tiết", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.getByRole("button", { name: "Đóng", exact: true }).click();
        }
        if (area === "billing") {
          await clickAndRefresh(page.getByRole("button", { name: "Thanh toán", exact: true }), "/api/workspace/billing");
          await expect
            .poll(
              () =>
                writes.find((w) => w.path === "/api/workspace/billing/start")
                  ?.body.invoice_id,
            )
            .toBe(991);
        }
      }
      for (const area of ["users", "stores", "invoices"]) {
        await page.goto(origin + "/platform/" + area);
        await inspect("platform/" + area);
        if (area === "invoices") {
          await page.getByRole('button',{name:'Ghi nhận thanh toán HD-000991',exact:true}).click();
          const form = page.getByRole('dialog').locator(".invoice-action-form");
          const before = writes.length;
          await expect(form).toBeVisible();
          await form.getByRole("button", { name: "Xác nhận đã nhận tiền", exact: true }).click();
          assert.equal(
            writes.length,
            before,
            "Invalid invoice form must not submit",
          );
          await form.getByLabel("Số tiền nhận (VNĐ)", { exact: true }).fill("50000");
          await form
            .getByLabel("Mã giao dịch", { exact: true })
            .fill("QA-REF-991");
          await clickAndRefresh(form.getByRole("button", { name: "Xác nhận đã nhận tiền", exact: true }), "/api/platform/invoices");
          await expect
            .poll(
              () =>
                writes.find(
                  (w) => w.path === "/api/platform/invoices/991/payment",
                )?.body.amount,
            )
            .toBe(50000);
          await page.getByRole('button',{name:'Hủy HD-000991',exact:true}).click();
          await page
            .getByLabel("Lý do hủy hóa đơn", { exact: true })
            .fill("Kiểm tra giao diện");
          await clickAndRefresh(page.getByRole("button", { name: "Xác nhận hủy hóa đơn", exact: true }), "/api/platform/invoices");
          await expect
            .poll(() =>
              writes.some((w) => w.path === "/api/platform/invoices/991/void"),
            )
            .toBe(true);
        }
      }
      for (const scope of ["admin", "platform"]) {
        await page.goto(origin + "/" + scope + "/emails");
        await page
          .getByRole("tab", {
            name:
              scope === "admin" ? "Chương trình CRM" : "Chương trình nền tảng",
            exact: true,
          })
          .click();
        await inspect(scope + " email programs");
        await page
          .getByRole("tab", { name: "Lịch sử gửi", exact: true })
          .click();
        await inspect(scope + " email history");
        await page.getByRole("button", { name: "Xem", exact: true }).click();
        await expect(
          page.getByTitle("Nội dung email đã xếp hàng", { exact: true }),
        ).toBeVisible();
      }
      await page.goto(origin + "/account");
      await page
        .getByRole("button", { name: "Đơn hàng của tôi", exact: true })
        .click();
      await inspect("customer order history");
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${engine.name()} ${width}px: workspace/platform lists, taxonomy tabs, email lists, billing form validation/submits, order details and customer history; all APIs mocked`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
