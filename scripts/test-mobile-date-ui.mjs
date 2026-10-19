import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20000 });
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
await mkdir(".local/screenshots", { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 414, height: 896 },
      isMobile: true,
      hasTouch: true,
      locale: "vi-VN",
      timezoneId: "America/Los_Angeles",
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [],
      writes = [],
      calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-10-19T12:00:00Z"));
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname;
      if (req.method() !== "GET") writes.push(path);
      calls.push(url);
      let data = [];
      if (path === "/api/auth/me")
        data = {
          user: {
            id: 999999,
            name: "QA",
            email: "qa@example.test",
            role: "owner",
            phone: "0901234567",
            birthday: "2000-10-19",
            memberships: [],
          },
        };
      else if (path.endsWith("/notifications")) data = { items: [] };
      else if (path === "/api/workspace/order-list")
        data = { columns: [], items: [], total: 0, page: 1, limit: 20 };
      else if (path === "/api/workspace/calendar")
        data = { orders: [], notes: [] };
      await route.fulfill({ json: data });
    });
    await page.goto(origin + "/admin/board");
    const date = page.getByLabel("Ngày giao", { exact: true });
    const control = page.locator(".board-filter-date .date-control");
    await expect(control.locator(".date-control-value")).toHaveText(
      "Chọn ngày",
    );
    await expect(date).toHaveValue("");
    await date.fill("2026-10-19");
    await expect(control.locator(".date-control-value")).toHaveText(
      "19/10/2026",
    );
    await expect
      .poll(() =>
        calls
          .filter((u) => u.pathname.endsWith("/order-list"))
          .at(-1)
          ?.searchParams.get("date"),
      )
      .toBe("2026-10-19");
    // Stub only the OS picker boundary; still trigger the actual input by tap.
    await date.evaluate((el) => {
      window.qaPickerCalls = 0;
      el.showPicker = () => window.qaPickerCalls++;
    });
    const box = await date.boundingBox();
    await page.touchscreen.tap(box.x + 15, box.y + box.height / 2);
    assert.equal(await page.evaluate(() => window.qaPickerCalls), 1);
    await page.keyboard.press("Escape");
    for (const width of [414, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 896 });
      const fit = await control.evaluate((el) => {
        const text = el.querySelector(".date-control-value"),
          input = el.querySelector("input");
        const r = el.getBoundingClientRect(),
          t = text.getBoundingClientRect(),
          i = input.getBoundingClientRect();
        return {
          fits: text.scrollWidth <= text.clientWidth,
          centerGap: Math.abs((t.top + t.bottom) / 2 - (r.top + r.bottom) / 2),
          contained:
            i.left >= r.left &&
            i.right <= r.right &&
            i.top >= r.top &&
            i.bottom <= r.bottom,
          height: r.height,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(fit.height, 44);
      assert(
        fit.fits && fit.contained && !fit.overflow,
        JSON.stringify({ width, ...fit }),
      );
      assert(fit.centerGap <= 1, "Date text vertically centered");
      const source = await page
        .getByRole("combobox", { name: "Nguồn tạo đơn", exact: true })
        .boundingBox();
      const dateBox = await control.boundingBox();
      assert(
        Math.abs(source.y - dateBox.y) <= 1 &&
          Math.abs(source.height - dateBox.height) <= 1,
        "Date aligns with adjacent dropdown",
      );
      if (width === 414 || width === 320)
        await page.screenshot({
          path: `.local/screenshots/date-mobile-${engine.name()}-${width}.png`,
        });
    }
    await control
      .getByRole("button", { name: "Xóa ngày đã chọn", exact: true })
      .click();
    await expect(date).toHaveValue("");
    await expect(control.locator(".date-control-value")).toHaveText(
      "Chọn ngày",
    );
    await expect
      .poll(
        () =>
          calls
            .filter((u) => u.pathname.endsWith("/order-list"))
            .at(-1)
            ?.searchParams.get("date") || "",
      )
      .toBe("");
    await page.goto(origin + "/admin/calendar");
    const month = page.getByLabel("Tháng", { exact: true });
    await month.fill("2026-11");
    await expect(month.locator("..").locator(".date-control-value")).toHaveText(
      "11/2026",
    );
    await page.getByRole("button", { name: "Tuần", exact: true }).click();
    const week = page.getByLabel("Tuần của ngày", { exact: true });
    await week.fill("2026-10-19");
    await expect(week.locator("..").locator(".date-control-value")).toHaveText(
      "19/10/2026",
    );
    await page.goto(origin + "/account");
    await page
      .getByRole("button", { name: "Thông tin cá nhân", exact: true })
      .click();
    const birthday = page.getByLabel("Sinh nhật", { exact: true });
    await birthday.fill("2000-02-29");
    await expect(
      birthday.locator("..").locator(".date-control-value"),
    ).toHaveText("29/02/2000");
    assert.equal(
      await birthday.evaluate((el) => new FormData(el.form).get("birthday")),
      "2000-02-29",
    );
    await birthday.evaluate((el) => el.form.reset());
    await expect(birthday).toHaveValue("2000-10-19");
    await expect(
      birthday.locator("..").locator(".date-control-value"),
    ).toHaveText("19/10/2000");
    assert.equal(
      await birthday.evaluate((el) => {
        el.required = true;
        el.value = "";
        return el.checkValidity();
      }),
      false,
      "Keep native required validation",
    );
    const constraint = await birthday.evaluate((el) => {
      el.required = false;
      el.min = "2001-01-01";
      el.value = "2000-01-01";
      return {
        native: el.type === "date",
        underflow: el.validity.rangeUnderflow,
        min: el.getAttribute("min"),
      };
    });
    assert.equal(constraint.min, "2001-01-01");
    // Windows WebKit reports date as type=text; only a browser with native
    // support can validate its OS date constraints. This is not an iOS test.
    if (constraint.native) assert.equal(constraint.underflow, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(
      `PASS ${engine.name()} mobile date: Vietnamese locale + US timezone, 414/390/375/320px, fixed date text centered, native picker tap, clear/filter, month/week, FormData/reset/validation; no writes`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
