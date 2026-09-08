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
let categoryId,
  productId,
  promoId,
  postId,
  uploadedPath,
  emailTemplateId,
  emailCampaignId;
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
  ssl:
    process.env.MYSQL_SSL === "true"
      ? { minVersion: "TLSv1.2", rejectUnauthorized: true }
      : undefined,
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
  for (const path of ["/product/does-not-exist", "/page-not-found"]) {
    const response = await fetch(origin + path);
    const html = await response.text();
    // A loading boundary can flush headers before notFound() resolves.
    check(
      [200, 404].includes(response.status) &&
        html.includes("404 — A LITTLE DETOUR") &&
        html.includes("noindex"),
      "Unknown route renders no-index 404 UI: " + path,
    );
  }
  check(
    (await guest("admin/notifications")).status === 401,
    "Guest cannot read admin notifications",
  );
  const aboutHtml = await (await fetch(origin + "/about")).text();
  check(
    !aboutHtml.includes("category_id"),
    "Information page omits product catalog payload",
  );
  const optimizedImage = await fetch(
    origin + "/_next/image?url=%2Fimages%2Ftulips.jpg&w=640&q=75",
    { headers: { Accept: "image/webp" } },
  );
  check(
    optimizedImage.status === 200 &&
      optimizedImage.headers.get("content-type").startsWith("image/"),
    "Responsive image optimizer serves local images",
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
  check(
    (await admin("admin/overview")).status === 200,
    "Admin overview aggregates are compatible",
  );
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
    (await customer("admin/notifications")).status === 403,
    "Customer cannot read admin notifications",
  );
  check(
    (await admin("admin/notifications")).data.items.some(
      (n) => n.key === "users:" + r.data.user.id,
    ),
    "New registration appears in admin notifications",
  );
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
  const editorNotifications = await editor("admin/notifications");
  check(
    editorNotifications.status === 200 &&
      editorNotifications.data.items.length === 0,
    "Editor cannot see order, user or support notifications",
  );
  check(
    (
      await guest("contact", "POST", {
        name: tag,
        email,
        message: "Kiểm thử thông báo hỗ trợ mới.",
      })
    ).status === 200,
    "Create support notification fixture",
  );
  const adminNotices = await admin("admin/notifications");
  check(
    adminNotices.status === 200 &&
      adminNotices.data.items.some(
        (n) => n.type === "inquiries" && n.detail === tag,
      ),
    "Support request appears in admin notifications",
  );
  check(
    adminNotices.data.items.every(
      (n) =>
        Number.isFinite(n.createdAt) &&
        !("email" in n) &&
        !("password_hash" in n),
    ),
    "Notification feed contains only minimal display fields",
  );
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
    gallery: ["/images/vase.jpg", "/images/roses.jpg"],
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
  const cachedProducts = await guest("catalog/products");
  check(
    cachedProducts.status === 200 &&
      cachedProducts.data.some((p) => p.id === productId),
    "Public catalog invalidated after product creation",
  );
  const createdGallery = cachedProducts.data.find(
    (p) => p.id === productId,
  ).gallery;
  check(
    JSON.stringify(
      typeof createdGallery === "string"
        ? JSON.parse(createdGallery)
        : createdGallery,
    ) === JSON.stringify(product.gallery),
    "Album persists and reaches public catalog in order",
  );
  check(
    (
      await admin("admin/products/" + productId, "PATCH", {
        ...product,
        gallery: ["javascript:alert(1)"],
      })
    ).status === 400,
    "Reject unsafe gallery URL",
  );
  check(
    (
      await admin("admin/products/" + productId, "PATCH", {
        ...product,
        gallery: Array(12).fill("/images/vase.jpg"),
      })
    ).status === 400,
    "Reject oversized album",
  );
  const legacyProduct = { ...product };
  delete legacyProduct.gallery;
  check(
    (await admin("admin/products/" + productId, "PATCH", legacyProduct))
      .status === 200,
    "Legacy product update supported",
  );
  const retained = (await admin("admin/products")).data.find(
    (p) => p.id === productId,
  ).gallery;
  check(
    JSON.stringify(
      typeof retained === "string" ? JSON.parse(retained) : retained,
    ) === JSON.stringify(product.gallery),
    "Legacy update preserves existing album",
  );
  await guest("catalog/products");
  await connection.execute("UPDATE products SET stock=1 WHERE id=?", [
    productId,
  ]);
  check(
    (await guest("catalog/products")).data.find((p) => p.id === productId)
      .stock === 2,
    "Repeated public request uses cached catalog",
  );
  const liveQuote = await guest("checkout/quote", "POST", {
    items: [{ productId, quantity: 2, size: "S" }],
    code: "",
  });
  check(
    liveQuote.status === 409 &&
      liveQuote.data.error.includes("không đủ số lượng"),
    "Checkout reads live stock while public catalog is cached",
  );
  const edited = await admin("admin/products/" + productId, "PATCH", {
    ...product,
    name: "Hoa kiểm thử cập nhật",
  });
  check(
    edited.status === 200 &&
      (await guest("catalog/products")).data.find((p) => p.id === productId)
        .name === "Hoa kiểm thử cập nhật",
    "Admin edit immediately expires public product cache",
  );
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
    address: "123 Đường Kiểm Thử, TP. Hà Nội",
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
  check(
    (await admin("admin/notifications")).data.items.some(
      (n) => n.type === "orders" && n.detail.includes(ref),
    ),
    "New order appears in admin notifications",
  );
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
    (await guest("admin/emails")).status === 401,
    "Guest cannot read email history",
  );
  check(
    (await customer("admin/emails")).status === 403,
    "Customer cannot read email history",
  );
  check(
    (await editor("admin/emails")).status === 403,
    "Editor cannot read email history",
  );
  const emailAdmin = await admin("admin/emails");
  check(
    emailAdmin.status === 200 &&
      emailAdmin.data.templates.length >= 6 &&
      !JSON.stringify(emailAdmin.data).includes("SMTP_PASSWORD="),
    "Admin reads templates and safe configuration",
  );
  const [confirmations] = await connection.execute(
    "SELECT * FROM email_outbox WHERE order_id=? AND template_key='order_confirmation'",
    [orderId],
  );
  check(
    confirmations.length === 1 && confirmations[0].body.includes(ref),
    "Checkout creates one confirmation with order reference",
  );
  const [statusEmails] = await connection.execute(
    "SELECT * FROM email_outbox WHERE order_id=? AND template_key='order_status'",
    [active.id],
  );
  check(
    statusEmails.length === 4,
    "Valid order transitions each create one email",
  );
  check(
    (
      await admin(
        "admin/emails/templates/" +
          emailAdmin.data.templates.find(
            (t) => t.template_key === "order_confirmation",
          ).id,
        "PATCH",
        {
          name: "Invalid",
          subject: "No reference",
          body: "Missing required order reference",
          active: 1,
        },
      )
    ).status === 400,
    "Transactional template cannot remove order reference",
  );
  let mailTemplate = await admin("admin/emails/templates", "POST", {
    name: tag + " CRM",
    subject: "Chào {{customer_name}}",
    body: "{{campaign_message}}\nChương trình {{campaign_name}}",
    active: 1,
  });
  check(mailTemplate.status === 200, "Create editable CRM template");
  emailTemplateId = mailTemplate.data.id;
  check(
    (
      await admin("admin/emails/templates/" + emailTemplateId, "PATCH", {
        name: "Invalid",
        subject: "{{unknown}}",
        body: "Unrecognized variables are rejected",
        active: 1,
      })
    ).status === 400,
    "Unknown template variables rejected",
  );
  const previewSafe = await admin("admin/emails/preview-template", "POST", {
    name: "Preview",
    subject: "Chào {{customer_name}}",
    body: "<script>alert(1)</script> {{customer_name}}",
    active: 1,
  });
  check(
    previewSafe.status === 200 &&
      !previewSafe.data.html.includes("<script>") &&
      previewSafe.data.html.includes("&lt;script&gt;"),
    "Template preview safely escapes HTML",
  );
  const crmEmail = {
    requestKey: randomUUID(),
    name: tag + " Campaign",
    templateId: emailTemplateId,
    segment: "all",
    customerId: crm.id,
    birthdayMonth: 9,
    message: "Cảm ơn bạn đã chọn Fleur.",
    promotionCode: "QA",
    eventDate: "20/10",
  };
  let emailPreview = await admin(
    "admin/emails/preview-campaign",
    "POST",
    crmEmail,
  );
  check(
    emailPreview.status === 200 && emailPreview.data.count === 1,
    "CRM preview filters consent, customer and birthday",
  );
  const excluded = await admin("admin/emails/preview-campaign", "POST", {
    ...crmEmail,
    birthdayMonth: 8,
  });
  check(
    excluded.status === 200 && excluded.data.count === 0,
    "CRM birthday filter excludes other months",
  );
  await admin("admin/users/" + editorId, "PATCH", {
    name: "QA Support",
    email: "editor-" + email,
    phone: "",
    role: "support",
    active: 1,
  });
  check(
    (await editor("admin/emails")).status === 200,
    "Support can view email workspace",
  );
  const supportFeed = await editor("admin/notifications");
  check(
    supportFeed.status === 200 &&
      supportFeed.data.items.some((n) => n.type === "orders") &&
      supportFeed.data.items.some((n) => n.type === "inquiries") &&
      supportFeed.data.items.every((n) => n.type !== "users"),
    "Support receives order and inquiry notifications without user data",
  );
  check(
    (
      await editor("admin/emails/templates/" + emailTemplateId, "PATCH", {
        name: "Denied",
        subject: "Chào {{customer_name}}",
        body: "Cannot change templates",
        active: 1,
      })
    ).status === 403,
    "Support cannot modify templates",
  );
  await admin("admin/users/" + editorId, "PATCH", {
    name: "QA Editor",
    email: "editor-" + email,
    phone: "",
    role: "editor",
    active: 1,
  });
  if (process.env.TEST_EMAIL_CAMPAIGNS === "1") {
    check(
      emailAdmin.data.configuration.from === "qa-sender@example.test",
      "Campaign tests target isolated SMTP configuration",
    );
    const approval = () => ({
      ...crmEmail,
      recipientIds: emailPreview.data.recipients.map((c) => c.id),
      templateVersion: emailPreview.data.templateVersion,
      audienceVersion: emailPreview.data.audienceVersion,
    });
    check(
      (
        await admin("admin/emails/campaigns", "POST", {
          ...approval(),
          recipientIds: [],
        })
      ).status === 409,
      "Cannot send to an unreviewed audience",
    );
    await admin("admin/emails/templates/" + emailTemplateId, "PATCH", {
      name: tag + " CRM",
      subject: "Chào {{customer_name}}",
      body: "{{campaign_message}}\nUpdated {{campaign_name}}",
      active: 1,
    });
    check(
      (await admin("admin/emails/campaigns", "POST", approval())).status ===
        409,
      "Template changes invalidate reviewed campaign even in same second",
    );
    emailPreview = await admin(
      "admin/emails/preview-campaign",
      "POST",
      crmEmail,
    );
    const campaignResult = await admin(
      "admin/emails/campaigns",
      "POST",
      approval(),
    );
    check(
      campaignResult.status === 200 && campaignResult.data.queued === 1,
      "Reviewed CRM campaign queues exactly eligible recipients",
    );
    emailCampaignId = campaignResult.data.id;
    const duplicateCampaign = await admin(
      "admin/emails/campaigns",
      "POST",
      approval(),
    );
    check(
      duplicateCampaign.status === 200 &&
        duplicateCampaign.data.id === emailCampaignId,
      "Campaign request retry does not duplicate campaign",
    );
    const [messages] = await connection.execute(
      "SELECT * FROM email_outbox WHERE campaign_id=?",
      [emailCampaignId],
    );
    check(
      messages.length === 1 &&
        messages[0].recipient === email &&
        messages[0].body.includes("Updated"),
      "Campaign stores personalized frozen email",
    );
    const u =
      origin + "/api/email/unsubscribe?token=" + messages[0].unsubscribe_token;
    const getUnsub = await fetch(u);
    const [[stillConsented]] = await connection.execute(
      "SELECT marketing_consent FROM customers WHERE id=?",
      [crm.id],
    );
    check(
      getUnsub.status === 200 && stillConsented.marketing_consent === 1,
      "Email scanner GET does not unsubscribe",
    );
    check(
      (await fetch(u, { method: "POST" })).status === 200,
      "Customer can unsubscribe without account login",
    );
    emailPreview = await admin(
      "admin/emails/preview-campaign",
      "POST",
      crmEmail,
    );
    check(
      emailPreview.data.count === 0,
      "Unsubscribed customer excluded from future campaigns",
    );
    check(
      (await fetch(origin + "/api/email/worker")).status === 401,
      "Worker rejects unauthenticated calls",
    );
  }

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
  check(
    (await admin("admin/products/" + productId, "DELETE", {})).status === 200 &&
      !(await guest("catalog/products")).data.some((p) => p.id === productId),
    "Hidden product disappears from cached public catalog",
  );
  console.log("All " + checks + " integration checks passed.");
} finally {
  await connection.execute("DELETE FROM inquiries WHERE email=?", [email]);
  if (emailCampaignId) {
    await connection.execute("DELETE FROM email_outbox WHERE campaign_id=?", [
      emailCampaignId,
    ]);
    await connection.execute("DELETE FROM email_campaigns WHERE id=?", [
      emailCampaignId,
    ]);
  }
  if (emailTemplateId)
    await connection.execute("DELETE FROM email_templates WHERE id=?", [
      emailTemplateId,
    ]);
  const [foundOrders] = await connection.execute(
    "SELECT id FROM orders WHERE email=?",
    [email],
  );
  const [foundCustomers] = await connection.execute(
    "SELECT id FROM customers WHERE email IN (?,?)",
    [email, "editor-" + email],
  );
  await connection.execute(
    "DELETE FROM email_outbox WHERE recipient IN (?,?)",
    [email, "editor-" + email],
  );
  await connection.execute(
    "DELETE FROM email_suppressions WHERE email IN (?,?)",
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
