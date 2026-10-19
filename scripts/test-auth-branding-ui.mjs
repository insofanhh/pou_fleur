import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const expect = baseExpect.configure({ timeout: 20000 });
await mkdir(".local/screenshots", { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const page = await context.newPage(),
        errors = [];
      let writes = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET") writes++;
        const data =
          path === "/api/auth/me"
            ? {
                user: {
                  id: 999999,
                  name: "QA",
                  email: "qa@example.test",
                  role: "customer",
                },
                ghost: null,
              }
            : [];
        await route.fulfill({ json: data });
      });
      for (const path of [
        "/login",
        "/register",
        "/reset-password?token=ui-only",
        "/account",
      ]) {
        await page.goto(origin + path);
        if (path === "/account")
          await page
            .getByRole("button", { name: "Đổi mật khẩu", exact: true })
            .click();
        const fields = page.locator(".password-control");
        await expect(fields.first()).toBeVisible();
        const before = writes;
        for (let i = 0; i < (await fields.count()); i++) {
          const field = fields.nth(i),
            input = field.locator("input"),
            toggle = field.getByRole("button");
          await input.fill("Private-QA-1234");
          await expect(input).toHaveAttribute("type", "password");
          await expect(toggle).toHaveAccessibleName(/^Hiện /);
          await toggle.click();
          await expect(input).toHaveAttribute("type", "text");
          await expect(toggle).toHaveAttribute("aria-pressed", "true");
          assert.equal(
            await input.evaluate((el) => new FormData(el.form).get(el.name)),
            "Private-QA-1234",
          );
          await toggle.click();
          await expect(input).toHaveAttribute("type", "password");
          await expect(input).toHaveValue("Private-QA-1234");
          const fits = await field.evaluate((el) => {
            const r = el.getBoundingClientRect(),
              b = el.querySelector("button").getBoundingClientRect();
            return (
              b.width >= 40 &&
              b.height >= 40 &&
              b.right <= r.right + 1 &&
              b.left >= r.left
            );
          });
          assert(
            fits,
            "Password toggle stays inside its field and has a usable target",
          );
        }
        assert.equal(
          writes,
          before,
          "Toggling visibility cannot submit a form",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "No horizontal overflow",
        );
        await expect(page.locator("header .brand-logo")).toBeVisible();
        assert(
          await page.locator("header .brand-mark").evaluate(el => el.getBoundingClientRect().width >= 24),
          "Header logo stays legible on mobile",
        );
        if (path === "/login") {
          const google = page.locator(".google-mark");
          if (await google.count()) {
            await expect(google).toHaveAttribute("src", "/brand/google-g.svg");
            assert(
              await google.evaluate(
                (el) => el.complete && el.naturalWidth === 20,
              ),
              "Official Google asset loads",
            );
          }
          await page.screenshot({
            path: `.local/screenshots/auth-brand-${engine.name()}-${width}.png`,
            fullPage: true,
          });
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `PASS ${engine.name()} ${width}px: password visibility, values, form safety, logo and overflow`,
      );
    }
  } finally {
    await browser.close();
  }
}
const response = await fetch(origin + "/login"),
  html = await response.text();
for (const rel of ["icon", "apple-touch-icon"])
  assert(html.includes(`rel="${rel}"`));
for (const path of [
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
]) {
  const r = await fetch(origin + path);
  assert(r.ok, path);
  assert(r.headers.get("content-type")?.includes("image/"), path);
  assert((await r.arrayBuffer()).byteLength > 100, path);
}
const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
assert(manifest.icons.some((icon) => icon.src === "/icons/icon-512.png"));
console.log("PASS favicon, Apple icon, PWA manifest and app icons");
