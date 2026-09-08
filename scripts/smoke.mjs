import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3001";
const tag = "qa-" + Date.now();
let checks = 0;
const userIds = [],
  orderIds = [],
  customerIds = [];
let categoryId, productId, promoId, postId, uploadedPath;
function client() {
  let cookie = "";
  return async (path, method = "GET", body, originOverride) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method !== "GET"
          ? {
              ...(body instanceof FormData
                ? {}
                : { "Content-Type": "application/json" }),
              origin: originOverride || origin,
            }
          : {}),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map((x) => x.split(";")[0]).join("; ");
    return { status: r.status, data: await r.json() };
  };
}
function check(cond, label) {
  assert.ok(cond, label);
  checks++;
  console.log("PASS " + label);
}
const admin = client(),
  customer = client(),
  editor = client(),
  guest = client();
const password = "Quality-check-" + randomUUID();
const email = tag + "@example.test";
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  for (const path of [
    "/",
    "/shop",
    "/cart",
    "/checkout",
    "/login",
    "/register",
    "/account",
    "/wishlist",
    "/journal",
    "/events",
    "/contact",
    "/policies",
    "/privacy",
    "/faq",
    "/track-order",
    "/admin",
  ]) {
    const r = await fetch(origin + path);
    check(r.status === 200, "Route " + path);
  }
  check(
    (await fetch(origin + "/product/does-not-exist")).status === 404,
    "Unknown product returns 404",
  );
  check(
    (await fetch(origin + "/page-not-found")).status === 404,
    "Unknown route returns 404",
  );
  for (const name of [
    "hero",
    "tulips",
    "roses",
    "daisies",
    "blush",
    "vase",
    "joy",
  ]) {
    const response = await fetch(origin + "/images/" + name + ".jpg");
    check(
      response.status === 200 &&
        response.headers.get("content-type").startsWith("image/"),
      "Asset " + name,
    );
  }
  check(
    (await guest("admin/users")).status === 401,
    "Guest cannot read admin data",
  );
  check(
    (
      await guest(
        "auth/register",
        "POST",
        { name: "CSRF", email, password },
        "https://attacker.example",
      )
    ).status === 403,
    "Cross-origin mutation blocked",
  );
  let r = await admin("auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  check(r.status === 200 && r.data.user.role === "admin", "Admin sign in");
  const upload = new FormData();
  upload.set(
    "file",
    new Blob([await readFile("public/images/tulips.jpg")], {
      type: "image/jpeg",
    }),
    "test.jpg",
  );
  let uploaded = await admin("upload", "POST", upload);
  check(
    uploaded.status === 200 && uploaded.data.url.startsWith("/uploads/"),
    "Authorized image upload",
  );
  uploadedPath = uploaded.data.url;
  check(
    (await fetch(origin + uploadedPath)).status === 200,
    "New uploaded image can be served",
  );
  const badUpload = new FormData();
  badUpload.set(
    "file",
    new Blob(["<script>alert(1)</script>"], { type: "image/jpeg" }),
    "bad.jpg",
  );
  check(
    (await admin("upload", "POST", badUpload)).status === 400,
    "Reject disguised non-image upload",
  );
  r = await customer("auth/register", "POST", {
    name: "Kiểm thử Fleur",
    email,
    password,
    consent: false,
  });
  check(
    r.status === 200 && r.data.user.role === "customer",
    "Register creates customer role",
  );
  userIds.push(r.data.user.id);
  check(
    (await customer("admin/products")).status === 403,
    "Customer cannot modify store",
  );
  r = await editor("auth/register", "POST", {
    name: "Biên tập kiểm thử",
    email: "editor-" + email,
    password,
    consent: false,
  });
  check(r.status === 200, "Create editor fixture");
  const editorId = r.data.user.id;
  userIds.push(editorId);
  r = await admin("admin/users/" + editorId, "PATCH", {
    name: "Biên tập kiểm thử",
    email: "editor-" + email,
    phone: "",
    role: "editor",
    active: 1,
  });
  check(r.status === 200, "Admin can assign editor");
  check(
    (await editor("admin/products")).status === 403,
    "Editor cannot access products",
  );
  r = await editor("admin/posts", "POST", {
    title: "Bài kiểm thử",
    slug: tag,
    excerpt: "Nội dung kiểm thử",
    content: "Bài viết dùng để kiểm thử xuất bản tin tức và phân quyền.",
    image: "https://images.unsplash.com/photo-1615216300340-86ddd7b31555",
    published: 0,
  });
  check(r.status === 200, "Editor can create draft");
  postId = r.data.id;
  r = await admin("admin/categories", "POST", {
    name: tag,
    slug: tag,
    description: "Fixture",
  });
  check(r.status === 200, "Create category");
  categoryId = r.data.id;
  const product = {
    name: "Hoa kiểm thử",
    slug: tag,
    category_id: categoryId,
    price: 500000,
    compare_price: null,
    stock: 2,
    image: "https://images.unsplash.com/photo-1615216300340-86ddd7b31555",
    description: "Thiết kế kiểm thử giao dịch và tồn kho.",
    flowers: "Tulip trắng",
    care: "Thay nước mỗi ngày.",
    badge: "",
    active: 1,
  };
  r = await admin("admin/products", "POST", product);
  check(r.status === 200, "Create product");
  productId = r.data.id;
  r = await admin("admin/promotions", "POST", {
    name: tag,
    code: tag,
    type: "percent",
    value: 150,
    min_order: 0,
    starts_at: "2026-01-01 00:00:00",
    ends_at: "2030-01-01 00:00:00",
    usage_limit: 10,
    active: 1,
  });
  check(r.status === 400, "Reject discount over 100 percent");
  r = await admin("admin/promotions", "POST", {
    name: tag,
    code: tag,
    type: "percent",
    value: 10,
    min_order: 400000,
    starts_at: "2026-01-01 00:00:00",
    ends_at: "2030-01-01 00:00:00",
    usage_limit: 10,
    active: 1,
  });
  check(r.status === 200, "Create valid promotion");
  promoId = r.data.id;
  r = await customer("checkout/quote", "POST", {
    items: [{ productId, quantity: 1, size: "S" }],
    code: tag,
  });
  check(
    r.status === 200 &&
      r.data.subtotal === 500000 &&
      r.data.discount === 50000 &&
      r.data.total === 485000,
    "Server calculates price discount shipping",
  );
  check(
    (
      await customer("checkout/quote", "POST", {
        items: [{ productId, quantity: -1, size: "S" }],
      })
    ).status === 400,
    "Reject negative quantity",
  );
  check(
    (
      await customer("checkout/quote", "POST", {
        items: [{ productId, quantity: 1, size: "S" }],
        code: "INVALID",
      })
    ).status === 400,
    "Reject invalid promotion",
  );
  const order = {
    items: [{ productId, quantity: 1, size: "S" }],
    code: tag,
    customerName: "Kiểm thử Fleur",
    email,
    phone: "0901234567",
    address: "123 Đường Kiểm Thử, TP. Hồ Chí Minh",
    recipientName: "Người nhận kiểm thử",
    recipientPhone: "0901234567",
    deliveryDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    deliverySlot: "09:00–12:00",
    message: "Chúc một ngày đẹp.",
    notes: "QA temporary fixture",
    paymentMethod: "cod",
    consent: false,
    idempotencyKey: randomUUID(),
  };
  r = await customer("checkout", "POST", order);
  check(r.status === 200 && r.data.total === 485000, "Create order");
  const ref = r.data.reference;
  r = await customer("checkout", "POST", order);
  check(
    r.status === 200 && r.data.reference === ref,
    "Idempotency prevents duplicate order",
  );
  r = await customer("orders");
  check(
    r.status === 200 && r.data.length === 1,
    "Customer sees only own orders",
  );
  const orderId = r.data[0].id;
  orderIds.push(orderId);
  r = await guest("orders/track", "POST", {
    reference: ref,
    email: "wrong@example.test",
  });
  check(r.status === 404, "Tracking requires matching email");
  r = await guest("orders/track", "POST", { reference: ref, email });
  check(
    r.status === 200 && r.data.status === "pending",
    "Guest tracking works with correct data",
  );
  r = await customer("orders/" + orderId + "/cancel", "POST", {});
  check(r.status === 200, "Customer can cancel pending order");
  r = await admin("admin/products");
  check(
    r.data.find((p) => p.id === productId).stock === 2,
    "Cancellation restores stock",
  );
  const duplicateBody = { ...order, code: "", idempotencyKey: randomUUID() };
  const duplicates = await Promise.all([
    customer("checkout", "POST", duplicateBody),
    customer("checkout", "POST", duplicateBody),
  ]);
  check(
    duplicates.every((r) => r.status === 200) &&
      duplicates[0].data.reference === duplicates[1].data.reference,
    "Concurrent duplicate request returns one order",
  );
  let duplicateOrders = await customer("orders");
  const duplicateOrder = duplicateOrders.data.find(
    (o) => o.reference === duplicates[0].data.reference,
  );
  await customer("orders/" + duplicateOrder.id + "/cancel", "POST", {});
  const race = await Promise.all([
    customer("checkout", "POST", {
      ...order,
      items: [{ productId, quantity: 2, size: "S" }],
      code: "",
      idempotencyKey: randomUUID(),
    }),
    customer("checkout", "POST", {
      ...order,
      items: [{ productId, quantity: 2, size: "S" }],
      code: "",
      idempotencyKey: randomUUID(),
    }),
  ]);
  check(
    race.filter((x) => x.status === 200).length === 1 &&
      race.filter((x) => x.status === 409).length === 1,
    "Concurrent checkout cannot oversell",
  );
  r = await customer("orders");
  const active = r.data.find((o) => o.status === "pending");
  orderIds.push(active.id);
  check(
    (await admin("admin/orders/" + active.id, "PATCH", { status: "delivered" }))
      .status === 400,
    "Invalid order transition blocked",
  );
  for (const status of ["confirmed", "preparing", "shipping", "delivered"])
    check(
      (await admin("admin/orders/" + active.id, "PATCH", { status })).status ===
        200,
      "Order transition " + status,
    );
  check(
    (await customer("orders/" + active.id + "/cancel", "POST", {})).status ===
      403,
    "Delivered paid order cannot be cancelled",
  );
  r = await admin("admin/crm");
  const crm = r.data.customers.find((c) => c.email === email);
  customerIds.push(
    ...r.data.customers
      .filter((c) => [email, "editor-" + email].includes(c.email))
      .map((c) => c.id),
  );
  check(
    crm && crm.order_count === 1 && Number(crm.total_spent) === 1000000,
    "CRM tracks completed spend and excludes cancellation",
  );
  check(!crm.marketing_consent, "Marketing consent is not assumed");
  check(
    (
      await admin("admin/crm/" + crm.id + "/notes", "POST", {
        content: "Khách thích tulip trắng.",
      })
    ).status === 200,
    "Save CRM note",
  );
  check(
    (
      await admin("admin/crm/" + crm.id + "/tasks", "POST", {
        title: "Chăm sóc sau mua",
        due_date: order.deliveryDate,
      })
    ).status === 200,
    "Create follow-up task",
  );
  r = await admin("admin/crm");
  const task = r.data.tasks.find((t) => t.customer_id === crm.id);
  check(
    (
      await admin("admin/crm/" + crm.id + "/tasks", "PATCH", {
        id: task.id,
        status: "done",
      })
    ).status === 200,
    "Complete follow-up task",
  );
  r = await customer("account", "PATCH", {
    name: "Khách kiểm thử",
    phone: "0901234567",
    address: "Địa chỉ kiểm thử",
    birthday: "1995-09-08",
    marketing_consent: true,
  });
  check(
    r.status === 200 && r.data.user.marketing_consent === 1,
    "Save profile and consent",
  );
  check(
    (
      await customer("account/password", "POST", {
        currentPassword: password,
        password: password + "-new",
      })
    ).status === 200,
    "Change password",
  );
  check((await customer("auth/logout", "POST", {})).status === 200, "Logout");
  check(
    (await customer("orders")).status === 401,
    "Logout invalidates session",
  );
  check(
    (
      await customer("auth/login", "POST", {
        email,
        password: password + "-new",
      })
    ).status === 200,
    "Login with changed password",
  );
  r = await admin("admin/users");
  check(
    r.status === 200 && !JSON.stringify(r.data).includes("password_hash"),
    "User list never exposes password hashes",
  );
  check(
    (await admin("admin/categories/" + categoryId, "DELETE", {})).status ===
      409,
    "Cannot remove category referenced by products",
  );
  const reset = await admin(
    "admin/users/" + editorId + "/reset-password",
    "POST",
    {},
  );
  check(reset.status === 200, "Admin issues expiring reset link");
  const token = new URL(reset.data.url).searchParams.get("token");
  check(
    (
      await guest("auth/reset-password", "POST", {
        token,
        password: password + "-reset",
      })
    ).status === 200,
    "One-time password reset works",
  );
  check(
    (
      await guest("auth/reset-password", "POST", {
        token,
        password: password + "-again",
      })
    ).status === 400,
    "Reset token cannot be reused",
  );
  check(
    (await editor("auth/me")).data.user === null,
    "Password reset invalidates previous sessions",
  );
  console.log("All " + checks + " integration checks passed.");
} finally {
  const [foundOrders] = await connection.execute(
    "SELECT id FROM orders WHERE email=?",
    [email],
  );
  const [foundCustomers] = await connection.execute(
    "SELECT id FROM customers WHERE email IN (?,?)",
    [email, "editor-" + email],
  );
  for (const c of foundCustomers) {
    await connection.execute("DELETE FROM crm_tasks WHERE customer_id=?", [
      c.id,
    ]);
    await connection.execute("DELETE FROM crm_notes WHERE customer_id=?", [
      c.id,
    ]);
    await connection.execute("DELETE FROM customers WHERE id=?", [c.id]);
  }
  for (const o of foundOrders) {
    await connection.execute("DELETE FROM order_items WHERE order_id=?", [
      o.id,
    ]);
    await connection.execute("DELETE FROM orders WHERE id=?", [o.id]);
  }
  if (productId)
    await connection.execute("DELETE FROM products WHERE id=?", [productId]);
  if (categoryId)
    await connection.execute("DELETE FROM categories WHERE id=?", [categoryId]);
  if (promoId)
    await connection.execute("DELETE FROM promotions WHERE id=?", [promoId]);
  if (postId)
    await connection.execute("DELETE FROM posts WHERE id=?", [postId]);
  for (const id of userIds) {
    await connection.execute("DELETE FROM audit_logs WHERE user_id=?", [id]);
    await connection.execute("DELETE FROM users WHERE id=?", [id]);
  }
  if (uploadedPath && /^\/uploads\/[a-f0-9-]{36}\.jpg$/.test(uploadedPath))
    await unlink("storage" + uploadedPath).catch(() => {});
  await connection.end();
}
