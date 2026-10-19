import { chooseSelect } from "./ui-controls.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
if (
  process.env.MYSQL_DATABASE !== "fleur_saas_test" ||
  process.env.MYSQL_PORT !== "3310"
)
  throw Error("Use isolated SaaS QA database");
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3005",
  stamp = Date.now(),
  email = `users-ui-${stamp}@example.test`,
  name = `Tài khoản UI ${stamp}`;
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { origin: base },
    data: { email: "owner@example.test", password: "SaaS-Testing-2026-Only" },
  });
  assert(login.ok());
  await page.goto(base + "/platform/users");
  await page
    .getByRole("button", { name: "Thêm tài khoản", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Họ tên", exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await dialog.locator('input[name="password"]').fill("Platform-UI-QA-2026");
  await dialog
    .getByRole("textbox", { name: "Lý do thao tác" })
    .fill("Tạo tài khoản kiểm thử UI");
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Tìm tài khoản" });
  await search.fill(email);
  const row = page.locator("tbody tr").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await expect(search).toHaveCSS("border-top-width", "0px");
  await expect(search.locator("..")).toHaveCSS("border-top-width", "1px");
  console.log("PASS Styled search and account creation through UI");
  await row.getByRole("button", { name: "Sửa", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Họ tên", exact: true })
    .fill(name + " mới");
  await dialog
    .getByRole("textbox", { name: "Lý do thao tác" })
    .fill("Cập nhật hồ sơ kiểm thử");
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: name + " mới", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Ghost", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Lý do thao tác" })
    .fill("Kiểm tra trải nghiệm người dùng");
  await dialog.getByRole("button", { name: "Bắt đầu Ghost" }).click();
  await page.waitForURL(base + "/");
  await expect(
    page.getByRole("complementary", { name: "Phiên hỗ trợ Ghost" }),
  ).toContainText("Đang Ghost: " + name + " mới");
  await page.getByRole("button", { name: "Quay lại admin" }).click();
  await page.waitForURL(base + "/platform/users");
  await expect(page.locator(".ghost-banner")).toHaveCount(0);
  await search.fill(email);
  await expect(row).toHaveCount(1);
  console.log(
    "PASS Profile edit, Ghost banner, target redirect and return to admin",
  );
  await row.getByRole("button", { name: "Sửa", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Cho phép đăng nhập" }).uncheck();
  await dialog
    .getByRole("textbox", { name: "Lý do thao tác" })
    .fill("Khóa tài khoản kiểm thử");
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator(".tag")).toHaveText("Đã khóa");
  await expect(
    row.getByRole("button", { name: "Ghost", exact: true }),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "Xóa", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Lý do thao tác" })
    .fill("Xóa mềm tài khoản kiểm thử");
  await dialog.getByRole("button", { name: "Xác nhận xóa" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await chooseSelect(
    page.getByRole("combobox", { name: "Trạng thái tài khoản" }),
    "deleted",
  );
  await expect(row.locator(".tag")).toHaveText("Đã xóa");
  await row.getByRole("button", { name: "Khôi phục", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Lý do thao tác" })
    .fill("Khôi phục tài khoản kiểm thử");
  await dialog
    .getByRole("button", { name: "Khôi phục tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await chooseSelect(
    page.getByRole("combobox", { name: "Trạng thái tài khoản" }),
    "current",
  );
  await expect(row.locator(".tag")).toHaveText("Đã khóa");
  await row.getByRole("button", { name: name + " mới", exact: true }).click();
  await expect(
    dialog.getByText("Nhật ký quản trị", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Xóa mềm tài khoản", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  console.log(
    "PASS Lock, soft delete, deleted filter, restore and audit profile through UI",
  );
  await page.screenshot({
    path: ".local/screenshots/platform-users-desktop.png",
    fullPage: true,
  });
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Users page mobile overflow",
    );
    await page
      .getByRole("button", { name: "Thêm tài khoản", exact: true })
      .click();
    const box = await dialog.boundingBox();
    assert(
      box.x >= 0 && box.x + box.width <= width + 1,
      "Dialog overflows mobile",
    );
    assert(
      await dialog
        .locator('input[name="email"]')
        .evaluate(
          (el) =>
            el.getBoundingClientRect().width <=
            el.closest("dialog").clientWidth,
        ),
      "Input exceeds dialog",
    );
    await page.screenshot({
      path: `.local/screenshots/platform-users-form-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `.local/screenshots/platform-users-${width}.png`,
      fullPage: true,
    });
    console.log(
      `PASS ${width}px mobile toolbar, table containment, form layout and modal`,
    );
  }
  assert.deepEqual(errors, []);
  console.log("PASS No browser runtime errors");
} finally {
  await browser.close();
}
