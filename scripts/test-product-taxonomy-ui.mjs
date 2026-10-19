import assert from "node:assert/strict";
import { chromium, webkit, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
await mkdir(".local/screenshots", { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of engine === chromium ? [1440] : [390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
      const categories = [], components = [], errors = [];
      const page = await context.newPage();
      page.on("pageerror", e => errors.push(e.message));
      await context.route("**/api/**", async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        let data = [], status = 200;
        if (path === "/api/auth/me") data = { user: { id: 9999, name: "UI QA", email: "ui@example.test", role: "owner", memberships: [] }, ghost: null };
        else if (path.endsWith("/notifications")) data = { items: [] };
        else if (path === "/api/admin/product-taxonomy") data = { categories, components };
        else if (path === "/api/admin/categories" || path === "/api/admin/flower_components") {
          const list = path.endsWith("/categories") ? categories : components;
          if (req.method() === "GET") data = list;
          else if (req.method() === "POST") {
            const input = req.postDataJSON();
            if (list.some(c => c.name === input.name)) { status = 409; data = { error: "Tên hoặc đường dẫn đã tồn tại." }; }
            else { const item = { ...input, id: list.length + 1 }; list.push(item); data = { ok: true, id: item.id }; }
          }
        } else if (req.method() !== "GET") {
          status = 400; data = { error: "No real mutations during presentation tests." };
        }
        await route.fulfill({ status, json: data });
      });
      await page.goto(origin + "/admin/products");
      await page.getByRole("button", { name: "Thêm sản phẩm", exact: true }).click();
      const dialog = page.getByRole("dialog"), select = nativeSelect(dialog, "Danh mục");
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue("");
      await chooseSelect(select, "__create__");
      let editor = dialog.locator(".taxonomy-editor");
      await editor.getByLabel("Tên danh mục", { exact: true }).fill("Hoa theo mùa");
      await editor.getByLabel("Đường dẫn", { exact: true }).press("Enter");
      await expect(editor).toHaveCount(0);
      await expect(select).toHaveValue("1");
      await chooseSelect(select, "__create__");
      editor = dialog.locator(".taxonomy-editor");
      await editor.getByLabel("Tên danh mục", { exact: true }).fill("Hoa theo mùa");
      await editor.getByRole("button", { name: "Tạo và chọn", exact: true }).click();
      await expect(editor.getByRole("alert")).toContainText("đã tồn tại");
      await editor.getByRole("button", { name: "Huỷ", exact: true }).click();
      await chooseSelect(nativeSelect(dialog, "Thành phần hoa"), "__create__");
      editor = dialog.locator(".taxonomy-editor");
      await editor.getByLabel("Tên thành phần hoa", { exact: true }).fill("Cẩm chướng");
      await editor.getByRole("button", { name: "Tạo và chọn", exact: true }).click();
      await expect(dialog.locator(".taxonomy-chip")).toContainText("Cẩm chướng");
      await dialog.locator(".product-taxonomy-fields").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.local/screenshots/taxonomy-fields-${engine.name()}-${width}.png` });
      await chooseSelect(nativeSelect(dialog, "Thành phần hoa"), "__create__");
      editor = dialog.locator(".taxonomy-editor");
      await editor.getByLabel("Tên thành phần hoa", { exact: true }).fill("Hoa hồng");
      await editor.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.local/screenshots/taxonomy-inline-${engine.name()}-${width}.png` });
      const overflow = await dialog.locator(".product-taxonomy-fields input:not([type=hidden]), .product-taxonomy-fields .ui-select-trigger, .taxonomy-editor").evaluateAll(elements => elements.filter(el => {
        const b = el.getBoundingClientRect(); return b.width && (b.left < 0 || b.right > innerWidth + 1);
      }).map(el => el.className));
      assert.deepEqual(overflow, []);
      await editor.getByRole("button", { name: "Huỷ", exact: true }).click();
      await dialog.locator(".editor-form > .button-row").getByRole("button", { name: "Huỷ", exact: true }).click();
      await page.goto(origin + "/admin/categories");
      await page.getByRole("tab", { name: "Thành phần hoa", exact: true }).click();
      await expect(page.getByRole("tabpanel")).toContainText("Cẩm chướng");
      await page.screenshot({ path: `.local/screenshots/taxonomy-tabs-${engine.name()}-${width}.png` });
      assert.deepEqual(errors, []);
      console.log(`PASS ${engine.name()} ${width}px: empty catalog, create via Enter, duplicate errors, composition chips, inline layout and unified manager`);
      await context.close();
    }
  } finally { await browser.close(); }
}
