import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";

// All APIs intercepted. Image fixture is generated locally; no mail/provider/DB writes.
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const expect = baseExpect.configure({ timeout: 15000 });
const out = ".local/ai-composer-qa";
await mkdir(out, { recursive: true });
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce", ...(engine === webkit ? { hasTouch: true, isMobile: true } : {}) });
    const errors = [], unexpected = [], sent = [], threads = new Map();
    let fail = false, enabled = true;
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let result = [], status = 200;
      if (path === "/api/activity") result = { ok: true };
      else if (path === "/api/auth/me") result = { user: { id: 999999, name: "Composer QA", role: "owner", email: "qa@example.test", memberships: [] }, ghost: null };
      else if (path.endsWith("/notifications")) result = { items: [] };
      else if (path === "/api/workspace/ai") result = { allowed: true, operational: true, enabled: true, used: 1, limit: 100, plan: "Studio", actorRole: "owner", imageInput: enabled };
      else if (path === "/api/workspace/ai/conversations") result = [...threads].map(([id]) => ({ id, title: "Hội thoại QA" }));
      else if (path.includes("/ai/conversations/")) result = { messages: threads.get(path.split("/").at(-1)) || [] };
      else if (path === "/api/workspace/ai/chat") {
        const body = req.postDataJSON(); sent.push(body);
        if (fail) { status = 503; result = { error: "Lỗi QA thử gửi lại" }; }
        else {
          const messages = [...(threads.get(body.conversationId) || []), { id: crypto.randomUUID(), role: "user", content: body.message, cards: (body.images || []).map(image => ({ type: "image", data: image })) }, { id: crypto.randomUUID(), role: "assistant", content: "QA đã nhận nội dung." }];
          threads.set(body.conversationId, messages); result = { messages, conversationId: body.conversationId };
        }
      } else if (req.method() !== "GET") unexpected.push(path);
      await route.fulfill({ status, json: result });
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    const encoded = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 1800; c.height = 1000;
      const ctx = c.getContext("2d"); ctx.fillStyle = "#f1f4ed"; ctx.fillRect(0, 0, 1800, 1000); ctx.fillStyle = "#284731"; ctx.font = "70px sans-serif"; ctx.fillText("Fleurious · Order QA", 70, 250);
      return c.toDataURL("image/png").split(",")[1];
    });
    const imageFile = { name: "Đơn hàng QA.png", mimeType: "image/png", buffer: Buffer.from(encoded, "base64") };
    for (const width of [1440, 768, 390, 320]) for (const mode of ["full", "quick"]) {
      await page.setViewportSize({ width, height: width < 600 ? 740 : 1000 });
      await page.goto(origin + (mode === "full" ? "/workspace/1/ai" : "/workspace/1/products"));
      if (mode === "quick") await page.getByRole("button", { name: "Mở chat nhanh với trợ lý AI", exact: true }).click();
      const form = page.locator(".ai-compose"), input = form.getByLabel("Yêu cầu trợ lý");
      await expect(input).toBeVisible();
      await expect(form.getByRole("button", { name: "Gửi yêu cầu", exact: true })).toBeDisabled();
      const size = await form.locator(".ai-compose-row").boundingBox();
      check(size.height <= 48, `${engine.name()} ${mode} ${width}: composer is one compact row`);
      await form.getByRole("button", { name: "Mở câu hỏi mẫu", exact: true }).click();
      const samples = form.getByRole("region", { name: "Câu hỏi mẫu", exact: true });
      await expect(samples).toBeVisible();
      const box = await samples.boundingBox();
      check(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0, "Question picker fits viewport");
      await samples.getByRole("button", { name: /Báo cáo 7 ngày/ }).click();
      await expect(input).toHaveValue("Báo cáo hoạt động trong 7 ngày gần nhất"); await expect(input).toBeFocused();
      await expect(samples).toHaveCount(0);
      const before = sent.length;
      await input.press("Shift+Enter"); check(sent.length === before, "Shift+Enter inserts newline without sending");
      await input.fill("Ghi chú đang nhập");
      await form.locator('input[type="file"]').setInputFiles(imageFile);
      await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toBeVisible();
      await expect(input).toHaveValue("Ghi chú đang nhập");
      await form.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${engine.name()}-${mode}-${width}.png` });
      await form.getByRole("button", { name: "Xóa ảnh đính kèm", exact: true }).click();
      await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toHaveCount(0);
      await form.locator('input[type="file"]').setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
      await expect(page.locator(".workspace-ai > .error")).toContainText("JPG, PNG hoặc WebP");
      check(sent.length === before, "Selecting or removing files never sends a chat");
      await form.locator('input[type="file"]').setInputFiles(imageFile);
      await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toBeVisible();
      fail = true; await input.press("Enter");
      await expect(page.locator(".workspace-ai > .error")).toContainText("Lỗi QA thử gửi lại");
      await expect(input).toHaveValue("Ghi chú đang nhập"); await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toBeVisible();
      fail = false; await form.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
      await expect(page.getByText("QA đã nhận nội dung.", { exact: true }).last()).toBeVisible();
      await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toHaveCount(0);
      await expect(page.getByAltText("Ảnh đã gửi cho trợ lý").last()).toBeVisible();
      const body = sent.at(-1), last = body.images[0];
      check(last.dataUrl.startsWith("data:image/jpeg;base64,") && Buffer.from(last.dataUrl.split(",")[1], "base64").length <= 512 * 1024, "Image is optimized privately before sending");
      check(!JSON.stringify(body).includes("https://"), "No public upload URLs");
      await form.getByRole("button", { name: "Mở câu hỏi mẫu", exact: true }).click();
      await samples.getByRole("button", { name: /Lịch giao hôm nay/ }).click();
      await expect(input).toHaveValue("Cho tôi xem lịch giao hoa hôm nay");
      await form.getByRole("button", { name: "Mở câu hỏi mẫu", exact: true }).click(); await samples.locator("button").first().focus(); await samples.locator("button").first().press("Escape");
      await expect(samples).toHaveCount(0); await expect(input).toBeVisible();
      await input.fill("");
      await form.locator('input[type="file"]').setInputFiles(imageFile);
      await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toBeVisible();
      await form.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
      await expect(form.getByAltText("Ảnh chuẩn bị gửi")).toHaveCount(0);
      check(sent.at(-1).message === "Hãy đọc ảnh này và hỗ trợ tôi xử lý nội dung." && sent.at(-1).images.length === 1, "Image-only message gets a clear default request");
      await expect(page.locator(".ai-message.assistant")).toHaveCount(2);
      await expect(page.locator(".ai-working")).toHaveCount(0);
      await page.waitForLoadState("networkidle");

      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal page overflow");
      console.log(`PASS ${engine.name()} ${mode} ${width}px: compact row, samples, image/remove/validation, failed-send retry, keyboard`);
    }
    enabled = false;
    await page.goto(origin + "/workspace/1/ai");
    await expect(page.getByRole("button", { name: "Tải ảnh lên", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Yêu cầu trợ lý")).toBeEnabled();
    check(true, "Text-only model keeps normal chat available and disables only upload");
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { await browser.close(); }
}
console.log(`${checks} composer UI checks passed; APIs intercepted`);
