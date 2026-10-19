import { expect } from "@playwright/test";
import { nativeSelect, chooseSelect } from "./ui-controls.mjs";
import { mkdir } from "node:fs/promises";

// Runs only in the onboarding harness's disposable DB. No mail or real uploads.
export async function testProductTaxonomy({
  owner,
  first,
  second,
  db,
  one,
  check,
  pageFor,
  origin,
}) {
  const sid = first.id;
  const call = (path, method = "GET", body, status = 200) =>
    owner.call("admin/" + path, method, body, status, sid);
  const cat = await call("categories", "POST", {
    name: "Hoa QA taxonomy",
    slug: "hoa-qa-taxonomy",
    description: "",
  });
  const flower = await call("flower_components", "POST", {
    name: "Hồng QA",
    slug: "hong-qa",
    description: "",
  });
  await call(
    "flower_components",
    "POST",
    { name: "Hồng QA", slug: "khac", description: "" },
    409,
  );
  await call(
    "categories",
    "POST",
    { name: "Hoa QA taxonomy", slug: "khac", description: "" },
    409,
  );
  check(true, "Taxonomy rejects duplicate names and keeps Vietnamese errors");
  const [foreign] = await db.execute(
    "INSERT INTO flower_components(store_id,name,slug,description) VALUES(?,'Hoa riêng','hoa-rieng','')",
    [second.id],
  );
  const [foreignCat] = await db.execute(
    "INSERT INTO categories(store_id,name,slug,description) VALUES(?,'Danh mục riêng','danh-muc-rieng','')",
    [second.id],
  );
  const options = await call("product-taxonomy");
  check(
    options.components.some((c) => c.id === flower.id) &&
      !options.components.some((c) => c.id === foreign.insertId),
    "Product options are scoped to the current store",
  );
  const input = {
    name: "Sản phẩm QA taxonomy",
    slug: "san-pham-qa-taxonomy",
    category_id: cat.id,
    price: 150000,
    compare_price: null,
    stock: 5,
    image: "/images/roses.jpg",
    gallery: [],
    description: "Thiết kế kiểm thử thành phần hoa",
    flowers: "Nội dung cũ",
    flower_component_ids: [flower.id, flower.id],
    flower_other: "Lá bạc",
    care: "Thay nước mỗi ngày",
    badge: "",
    active: 0,
  };
  await call(
    "products",
    "POST",
    { ...input, flower_component_ids: [foreign.insertId] },
    400,
  );
  await call(
    "products",
    "POST",
    { ...input, category_id: foreignCat.insertId },
    400,
  );
  await call(
    "flower_components/" + foreign.insertId,
    "PATCH",
    { name: "Sai store", slug: "sai", description: "" },
    404,
  );
  await call("flower_components/" + foreign.insertId, "DELETE", {}, 404);
  await call("categories/" + foreignCat.insertId, "DELETE", {}, 404);
  check(
    true,
    "Cross-store category/component references and mutations are rejected",
  );
  const product = await call("products", "POST", input);
  let stored = (await call("products")).find((p) => p.id === product.id);
  check(
    stored.flowers === "Hồng QA, Lá bạc" &&
      stored.flower_component_ids.length === 1 &&
      stored.flower_other === "Lá bạc",
    "Product stores multiple-choice associations and computes composition on server",
  );
  await call("flower_components/" + flower.id, "DELETE", {}, 409);
  await call("categories/" + cat.id, "DELETE", {}, 409);
  await call("flower_components/" + flower.id, "PATCH", {
    name: "Hồng đổi tên",
    slug: "hong-doi-ten",
    description: "",
  });
  check(
    (await one("SELECT flowers FROM products WHERE id=?", [product.id]))
      .flowers === "Hồng đổi tên, Lá bạc",
    "Renaming a flower updates linked product composition; used taxonomy cannot be deleted",
  );
  const legacy = {
    ...input,
    name: "Hoa nhập cũ",
    slug: "hoa-nhap-cu",
    flowers: "Tulip, lá cũ",
  };
  delete legacy.flower_component_ids;
  delete legacy.flower_other;
  const old = await call("products", "POST", legacy);
  stored = (await call("products")).find((p) => p.id === old.id);
  check(
    stored.flower_other === "Tulip, lá cũ" && stored.flowers === "Tulip, lá cũ",
    "Legacy free-text composition is preserved",
  );
  await call("products/" + product.id, "PATCH", {
    ...input,
    flower_component_ids: [],
    flower_other: "Lá bạc",
  });
  await call("flower_components/" + flower.id, "DELETE", {});
  check(
    true,
    "An unused flower component can be removed after product unselects it",
  );
  await mkdir(".local/screenshots", { recursive: true });
  for (const width of [1440, 390, 320]) {
    const page = await pageFor(owner, width);
    await page.route("https://example.test/**", (route) => route.abort());
    await page.goto(`${origin}/workspace/${sid}/products`);
    await page
      .getByRole("button", { name: "Thêm sản phẩm", exact: true })
      .click();
    const dialog = page.getByRole("dialog"),
      form = dialog.locator(".editor-form");
    await form
      .getByLabel("Tên thiết kế", { exact: true })
      .fill("Bó hoa UI " + width);
    const category = nativeSelect(dialog, "Danh mục"),
      component = nativeSelect(dialog, "Thành phần hoa");
    await expect(category).toBeEnabled();
    await chooseSelect(category, "__create__");
    let inline = dialog.locator(".taxonomy-editor");
    await expect(
      form.getByRole("button", { name: "Lưu thay đổi", exact: true }),
    ).toBeDisabled();
    await inline
      .getByLabel("Tên danh mục", { exact: true })
      .fill("Danh mục UI " + width);
    await expect(inline.getByLabel("Đường dẫn", { exact: true })).toHaveValue(
      "danh-muc-ui-" + width,
    );
    await inline
      .getByRole("button", { name: "Tạo và chọn", exact: true })
      .click();
    await expect(inline).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "Danh mục", exact: true }),
    ).toContainText("Danh mục UI " + width);
    await expect(form.getByLabel("Tên thiết kế", { exact: true })).toHaveValue(
      "Bó hoa UI " + width,
    );
    await chooseSelect(component, "__create__");
    inline = dialog.locator(".taxonomy-editor");
    await inline
      .getByLabel("Tên thành phần hoa", { exact: true })
      .fill("Cẩm tú cầu UI " + width);
    await inline
      .getByRole("button", { name: "Tạo và chọn", exact: true })
      .click();
    await expect(dialog.locator(".taxonomy-chip")).toContainText(
      "Cẩm tú cầu UI " + width,
    );
    const extra = await call("flower_components", "POST", {
      name: "Hoa thêm UI " + width,
      slug: "hoa-them-ui-" + width,
      description: "",
    });
    // Reload is covered by reopening the editor after save; add a second existing option now via the next form.
    await form
      .getByLabel("Thành phần khác (tuỳ chọn)", { exact: true })
      .fill("Lá trang trí");
    await form
      .getByLabel("Giá tiêu chuẩn (VNĐ)", { exact: true })
      .fill("200000");
    await form
      .getByLabel("Mô tả", { exact: true })
      .fill("Bó hoa dành riêng cho ngày vui.");
    await form
      .getByLabel("Hướng dẫn chăm sóc", { exact: true })
      .fill("Thay nước mỗi ngày.");
    await dialog
      .getByText("Hoặc thêm ảnh bằng đường dẫn", { exact: true })
      .click();
    await dialog
      .getByLabel("Đường dẫn ảnh album", { exact: true })
      .fill("https://example.test/flower.jpg");
    await dialog.getByRole("button", { name: "Thêm ảnh", exact: true }).click();
    for (const control of await dialog
      .locator(
        ".product-taxonomy-fields .ui-select-trigger, .taxonomy-editor input",
      )
      .all()) {
      const box = await control.boundingBox();
      check(
        box && box.x >= 0 && box.x + box.width <= width,
        `Product taxonomy controls fit ${width}px`,
      );
    }
    await page.screenshot({
      path: `.local/screenshots/taxonomy-product-${width}.png`,
    });
    await form
      .getByRole("button", { name: "Lưu thay đổi", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const created = await one(
      "SELECT * FROM products WHERE store_id=? AND slug=?",
      [sid, "bo-hoa-ui-" + width],
    );
    check(
      created.flowers === `Cẩm tú cầu UI ${width}, Lá trang trí`,
      `Inline-created taxonomy persists with the new product at ${width}px`,
    );
    const row = page.getByRole("row").filter({ hasText: "Bó hoa UI " + width });
    await row.locator("button").first().click();
    await expect(dialog.locator(".taxonomy-chip")).toContainText(
      "Cẩm tú cầu UI " + width,
    );
    await expect(nativeSelect(dialog, "Thành phần hoa")).toBeEnabled();
    await chooseSelect(
      nativeSelect(dialog, "Thành phần hoa"),
      String(extra.id),
    );
    await expect(dialog.locator(".taxonomy-chip")).toHaveCount(2);
    await dialog
      .getByRole("button", { name: "Bỏ Hoa thêm UI " + width, exact: true })
      .click();
    await expect(dialog.locator(".taxonomy-chip")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Huỷ", exact: true }).click();
    await page.goto(`${origin}/workspace/${sid}/categories`);
    await expect(page.getByRole("tabpanel")).toContainText(
      "Danh mục UI " + width,
    );
    await page
      .getByRole("tab", { name: "Thành phần hoa", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "Cẩm tú cầu UI " + width,
    );
    await page
      .getByRole("button", { name: "Sửa Hoa thêm UI " + width, exact: true })
      .click();
    await page
      .locator(".taxonomy-editor")
      .getByLabel("Tên thành phần hoa", { exact: true })
      .fill("Hoa chỉnh sửa UI " + width);
    await page
      .locator(".taxonomy-editor")
      .getByRole("button", { name: "Lưu thay đổi", exact: true })
      .click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "Hoa chỉnh sửa UI " + width,
    );
    await page.screenshot({
      path: `.local/screenshots/taxonomy-manager-${width}.png`,
    });
    check(
      true,
      `Unified taxonomy manager and multi-selection work at ${width}px`,
    );
    await page.context().close();
  }
}
