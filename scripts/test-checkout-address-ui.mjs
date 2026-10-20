import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import mysql from "mysql2/promise";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import { chromium, webkit, expect } from "@playwright/test";

const origin = process.env.TEST_ORIGIN || "http://localhost:3005";
assert(
  ["http://localhost:3005", "http://127.0.0.1:3005"].includes(origin),
  "Isolated QA app only",
);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3310,
  user: "root",
  database: "fleur_saas_test",
});
const key = randomBytes(6).toString("hex"),
  slug = "checkout-address-" + key;
let uid,
  sid,
  checks = 0;
const check = (ok, label) => {
  assert(ok, label);
  checks++;
  console.log("PASS", label);
};
const addresses = {
  gift: {
    description: "1002 Đường Láng, Đống Đa, Hà Nội",
    point: { lat: 21.0245, lng: 105.8028 },
  },
  self: {
    description: "12 Phố Huế, Hai Bà Trưng, Hà Nội",
    point: { lat: 21.019, lng: 105.85 },
  },
};
await mkdir(".local/checkout-address", { recursive: true });
try {
  const [user] = await db.execute(
    "INSERT INTO users(name,email,password_hash) VALUES(?,?,'not-a-login-hash')",
    ["Checkout address QA", `checkout-${key}@example.test`],
  );
  uid = user.insertId;
  const [store] = await db.execute(
    "INSERT INTO stores(slug,name,owner_id,status,settings,theme) VALUES(?,?,?,'approved',?,'{}')",
    [
      slug,
      "Checkout QA",
      uid,
      JSON.stringify({ open: true, shipping: 0, slots: ["09:00–12:00"] }),
    ],
  );
  sid = store.insertId;
  await db.execute(
    "INSERT INTO store_bank_accounts(store_id,bank_code,bank_name,account_number,account_holder,enabled) VALUES(?,'QA','QA Bank','00000000','QA',1)",
    [sid],
  );
  const [cat] = await db.execute(
    "INSERT INTO categories(store_id,name,slug) VALUES(?,'Hoa QA',?)",
    [sid, key],
  );
  const [product] = await db.execute(
    "INSERT INTO products(store_id,category_id,name,slug,price,stock,image,description,flowers,care) VALUES(?,?,'Bó hoa QA',?,200000,100,'/images/roses.jpg','Hoa kiểm thử','Hồng','Nước sạch')",
    [sid, cat.insertId, key],
  );
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
        ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}),
      });
      await context.addInitScript(
        ({ slug, pid }) =>
          localStorage.setItem(
            "fleur.cart." + slug,
            JSON.stringify([{ productId: pid, quantity: 1, size: "S" }]),
          ),
        { slug, pid: product.insertId },
      );
      let searchMode = "ok",
        failDetail = false;
      const submits = [],
        maps = [],
        errors = [];
      await context.route("**/api/**", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          path = url.pathname;
        let data = {},
          status = 200;
        if (path === "/api/auth/me") data = { user: null };
        else if (path === "/api/store")
          data = { name: "Checkout QA", settings: {}, theme: {} };
        else if (path === "/api/checkout/quote")
          data = { total: 200000, subtotal: 200000, discount: 0, shipping: 0 };
        else if (path === "/api/checkout") {
          submits.push(request.postDataJSON());
          status = 409;
          data = { error: "QA: đã kiểm tra thông tin, không tạo đơn thật." };
        } else if (path.startsWith("/api/goong/")) {
          maps.push({ path, scope: request.headers()["x-fleur-store"] });
          if (path.endsWith("/search")) {
            if (searchMode === "error") {
              status = 502;
              data = { error: "QA Goong unavailable" };
            } else {
              const mode = url.searchParams.get("input").includes("Huế")
                ? "self"
                : "gift";
              data = {
                predictions:
                  searchMode === "empty"
                    ? []
                    : [
                        {
                          place_id: mode,
                          description: addresses[mode].description,
                        },
                      ],
              };
            }
          } else if (failDetail) {
            status = 502;
            data = { error: "QA place unavailable" };
          } else
            data = {
              result: {
                geometry: {
                  location: addresses[url.searchParams.get("place_id")].point,
                },
              },
            };
        }
        await route.fulfill({ status, json: data });
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${origin}/s/${slug}/checkout`);
      const address = page.getByRole("combobox", {
        name: "Địa chỉ nhận hoa",
        exact: true,
      });
      await expect(address).toBeVisible();
      await page.getByLabel("Họ và tên", { exact: true }).fill("Khách QA");
      await page
        .getByLabel("Số điện thoại", { exact: true })
        .fill("0901234567");
      await page
        .getByLabel("Email", { exact: true })
        .fill("checkout@example.test");
      await page
        .getByLabel("Tên người nhận", { exact: true })
        .fill("Người nhận QA");
      await page
        .getByLabel("Số điện thoại người nhận", { exact: true })
        .fill("0901234568");
      await page.locator('input[type="checkbox"][required]').check();
      await chooseSelect(nativeSelect(page, "Người thanh toán COD"),"buyer");
      const select = async (mode, keyboard = false) => {
        await address.fill(mode === "gift" ? "1002 Đường Láng" : "12 Phố Huế");
        const option = page.getByRole("option", {
          name: addresses[mode].description,
          exact: true,
        });
        await expect(option).toBeVisible();
        if (keyboard) {
          await address.press("ArrowDown");
          await address.press("Enter");
        } else if (engine === webkit) await option.tap();
        else await option.click();
        await expect(address).toHaveValue(addresses[mode].description);
        await expect(
          page.getByText("Đã chọn vị trí giao hoa.", { exact: false }),
        ).toBeVisible();
      };
      const submit = async () => {
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/checkout") &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "Đặt hoa", exact: true })
          .click();
        await response;
        await expect(
          page.locator('.checkout-layout [role="alert"]'),
        ).toContainText("QA:");
        await expect(
          page.getByRole("button", { name: "Đặt hoa", exact: true }),
        ).toBeEnabled();
      };
      await select("gift", true);
      await submit();
      check(
        submits.length === 1 &&
          submits[0].address === addresses.gift.description &&
          submits[0].deliveryLat === addresses.gift.point.lat &&
          submits[0].deliveryLng === addresses.gift.point.lng &&
          submits[0].deliveryMode === "gift",
        `${engine.name()}: gift address selected by keyboard sends matching coordinates`,
      );
      await page.locator('input[name="deliveryMode"][value="self"]').check();
      await expect(address).toHaveValue("");
      await select("self");
      await submit();
      check(
        submits.length === 2 &&
          submits[1].deliveryMode === "self" &&
          submits[1].recipientName === "Khách QA" &&
          submits[1].address === addresses.self.description &&
          submits[1].deliveryLat === addresses.self.point.lat,
        `${engine.name()}: self delivery uses its own address, location and buyer details`,
      );
      await page.locator('input[name="deliveryMode"][value="gift"]').check();
      await expect(address).toHaveValue(addresses.gift.description);
      await submit();
      check(
        submits.length === 3 &&
          submits[2].deliveryLat === addresses.gift.point.lat,
        `${engine.name()}: switching back restores gift address and location`,
      );
      await address.fill("20 Địa chỉ tự nhập, Hà Nội");
      await submit();
      check(
        submits.length === 4 &&
          !Object.hasOwn(submits[3], "deliveryLat") &&
          !Object.hasOwn(submits[3], "deliveryLng"),
        `${engine.name()}: manual edit clears stale coordinates`,
      );
      await chooseSelect(nativeSelect(page, "Người thanh toán COD"),"recipient");
      check(!(await page.locator("form.checkout-layout").evaluate(el=>el.checkValidity())),`${engine.name()}: recipient-pays COD requires explicit agreement`);
      await page.locator(".cod-payer-fields input[type=checkbox]").check();
      await submit();
      check(submits[4].codPayer==="recipient"&&submits[4].codRecipientConsent===true,`${engine.name()}: recipient agreement is sent as a boolean`);
      await page.locator('input[name="payment"][value="bank"]').check();
      await expect(page.locator(".cod-payer-fields")).toHaveCount(0);
      await submit();
      check(!Object.hasOwn(submits[5],"codPayer"),`${engine.name()}: bank payment hides and omits COD-only fields`);
      searchMode = "empty";
      await address.fill("Địa chỉ không có kết quả");
      await expect(
        page.getByRole("status").filter({ hasText: "Chưa có địa chỉ phù hợp" }),
      ).toBeVisible();
      searchMode = "error";
      await address.fill("Địa chỉ lỗi tìm kiếm");
      await expect(
        page.getByRole("status").filter({ hasText: "Chưa tìm được vị trí" }),
      ).toBeVisible();
      check(
        true,
        `${engine.name()}: empty/error search results explain manual fallback`,
      );
      searchMode = "ok";
      failDetail = true;
      await address.fill("1002 Láng");
      await page
        .getByRole("option", { name: addresses.gift.description, exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "Chưa lấy được vị trí" }),
      ).toBeVisible();
      check(
        (await address.inputValue()) === "1002 Láng",
        `${engine.name()}: failed selection preserves input without inventing coordinates`,
      );
      failDetail = false;
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const searched = page.waitForResponse(
          (r) =>
            r.url().includes("/api/goong/search?") &&
            new URL(r.url()).searchParams.get("input") === "1002 Láng " + width,
        );
        await address.fill("1002 Láng " + width);
        await searched;
        const option = page.getByRole("option", {
          name: addresses.gift.description,
          exact: true,
        });
        await expect(option).toBeVisible();
        await option.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            option.evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.left >= 0 && r.right <= innerWidth + 1;
            }),
          )
          .toBe(true);
        const payments = page.locator(".payment-option");
        await expect(payments).toHaveCount(2);
        const gap = await payments.evaluateAll(
          (els) =>
            els[1].getBoundingClientRect().top -
            els[0].getBoundingClientRect().bottom,
        );
        check(
          gap >= 11,
          `${engine.name()}: address suggestions fit and payment options have spacing at ${width}px`,
        );
        await page.screenshot({
          path: `.local/checkout-address/${engine.name()}-${width}.png`,
        });
      }
      check(
        maps.every((m) => m.scope === slug),
        `${engine.name()}: suggestions use the current store scope`,
      );
      check(
        errors.length === 0,
        `${engine.name()}: no browser runtime errors: ${errors.join("; ")}`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    `${checks} checkout address UI checks passed; Goong mocked, no real orders or emails`,
  );
} finally {
  if (sid) {
    for (const table of ["products", "categories", "store_bank_accounts"])
      await db.execute(`DELETE FROM ${table} WHERE store_id=?`, [sid]);
    await db.execute("DELETE FROM stores WHERE id=?", [sid]);
  }
  if (uid) await db.execute("DELETE FROM users WHERE id=?", [uid]);
  await db.end();
}
