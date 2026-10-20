import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, expect as pwExpect } from "@playwright/test";

// Presentation/interaction regression on the existing dev server. ALL API calls
// are intercepted: no real orders, messages, mail, payments or provider calls.
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local app only");
const expect = pwExpect.configure({ timeout: 20000 });
const out = ".local/ai-widget-qa";
await mkdir(out, { recursive: true });
const report = [];
function check(value, name) { assert(value, name); report.push(name); console.log("PASS", name); }

for (const engine of process.argv.includes("--webkit") ? [webkit] : process.argv.includes("--chromium") ? [chromium] : [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block", ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}) });
    let identity = { id: 999991, role: "owner", name: "Widget QA", email: "widget@example.test", memberships: [] };
    let access = { allowed: true, operational: true, enabled: true, used: 0, limit: 50, plan: "Studio", month: "2026-10", actorRole: "owner" };
    let failAccess = false, failSend = false, slowReply = false, actions = 0;
    const reads = [], writes = [], errors = [], tenantHeaders = [], conversations = new Map();
    await context.route("**/api/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
      if (path.startsWith("/api/workspace/ai")) {
        tenantHeaders.push(req.headers()["x-fleur-store"] === new URL(req.frame().url()).pathname.split("/")[2]);
      }
      if (method === "GET") reads.push(path); else writes.push(path);
      let data = [], status = 200;
      if (path === "/api/auth/me") data = { user: identity, ghost: null };
      else if (path.endsWith("/notifications")) data = { items: [], userId: identity?.id };
      else if (path === "/api/admin/overview") data = { stats: {}, revenue: [], recent: [], top: [] };
      else if (path === "/api/admin/products") data = [];
      else if (path === "/api/workspace/ai") {
        data = access;
        if (failAccess) { status = 503; data = { error: "Lỗi tải trợ lý QA" }; }
      } else if (path === "/api/workspace/ai/conversations") data = [...conversations].map(([id]) => ({ id, title: "Hội thoại QA" }));
      else if (path.startsWith("/api/workspace/ai/conversations/")) {
        const id = path.split("/").at(-1);
        if (method === "DELETE") { conversations.delete(id); data = { ok: true }; }
        else data = { messages: conversations.get(id) || [] };
      } else if (path === "/api/workspace/ai/chat") {
        const body = req.postDataJSON();
        if (slowReply) await new Promise(resolve => setTimeout(resolve, 700));
        if (failSend) { status = 503; data = { error: "Không thể kết nối trợ lý QA" }; }
        else {
          const previous = conversations.get(body.conversationId) || [];
          const cards = body.message.includes("ghi chú") ? [{ title: "Xem trước ghi chú", actionId: "qa-note", status: "pending", data: { title: "Chuẩn bị hoa", content: "Kiểm tra trước giờ giao" } }] : [];
          const messages = [...previous, { id: crypto.randomUUID(), role: "user", content: body.message }, { id: crypto.randomUUID(), role: "assistant", content: "Phản hồi trợ lý QA", cards }];
          conversations.set(body.conversationId, messages); access = { ...access, used: access.used + 1 };
          data = { conversationId: body.conversationId, messages };
        }
      } else if (path.startsWith("/api/workspace/ai/actions/")) {
        actions++;
        for (const messages of conversations.values()) for (const m of messages) for (const c of m.cards || []) c.status = req.postDataJSON().cancel ? "cancelled" : "done";
        data = { result: { message: "Đã tạo ghi chú QA" } };
      } else if (method !== "GET") {
        status = 400; data = { error: "Unexpected mutation blocked in UI QA" };
      }
      await route.fulfill({ status, json: data });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const launcher = page.getByRole("button", { name: "Mở chat nhanh với trợ lý AI", exact: true });
    const dialog = page.getByRole("dialog", { name: "Chat nhanh với trợ lý AI", exact: true });
    const prompt = () => dialog.getByLabel("Yêu cầu trợ lý");
    const minimize = () => dialog.getByRole("button", { name: "Thu gọn hội thoại", exact: true }).click();

    await page.goto(origin + "/workspace/1/overview");
    await expect(launcher).toBeVisible();
    await page.screenshot({ path: `${out}/${engine.name()}-launcher.png` });
    check(!reads.some(p => p.startsWith("/api/workspace/ai")), "No AI API requests before first open");
    failAccess = true;
    await launcher.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog.getByRole("status")).toContainText("Lỗi tải trợ lý QA");
    failAccess = false;
    await dialog.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(prompt()).toBeVisible();
    await page.screenshot({ path: `${out}/${engine.name()}-welcome.png` });
    check(!reads.includes("/api/workspace/ai/attention") && !reads.includes("/api/workspace/ai/reminders"), "Quick chat does not fetch unrelated dashboard data");
    await prompt().fill("Nội dung đang nhập");
    await prompt().press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.click();
    await expect(prompt()).toHaveValue("Nội dung đang nhập");
    check(true, "Escape minimizes, restores launcher focus and preserves draft");

    await minimize();
    const minimizedReads = reads.filter(p => p.startsWith("/api/workspace/ai")).length;
    await page.clock.install();
    await page.clock.fastForward(31000);
    check(reads.filter(p => p.startsWith("/api/workspace/ai")).length === minimizedReads, "Minimized chat stops background AI polling");
    await page.clock.resume();
    await page.locator(".admin-sidebar").getByRole("link", { name: "Sản phẩm", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/1\/products$/);
    await launcher.click();
    await expect(prompt()).toHaveValue("Nội dung đang nhập");
    check(true, "Draft survives workspace client navigation");

    slowReply = true;
    await prompt().fill("Xin chào");
    await dialog.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
    await expect(dialog.getByRole("link", { name: "Mở trang Trợ lý AI", exact: true })).toHaveAttribute("aria-disabled", "true");
    check(true, "Expanding waits for pending reply rather than opening an incomplete transcript");
    await minimize();
    await expect(page.getByRole("status", { name: "Trợ lý AI có phản hồi mới", exact: true })).toBeVisible();
    await launcher.click();
    await expect(page.getByRole("status", { name: "Trợ lý AI có phản hồi mới", exact: true })).toHaveCount(0);
    check(true, "Reply while minimized shows unread dot and opening clears it");
    await expect(dialog.getByText("Phản hồi trợ lý QA", { exact: true })).toBeVisible();
    check(writes.filter(p => p === "/api/workspace/ai/chat").length === 1, "Minimizing in-flight chat neither cancels nor duplicates request");
    slowReply = false;

    await prompt().fill("Tạo ghi chú");
    await prompt().press("Enter");
    await expect(dialog.getByText("Xem trước ghi chú", { exact: true })).toBeVisible();
    check(actions === 0, "Proposal cannot change data before explicit confirmation");
    await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
    await expect(dialog.getByText("Đã thực hiện", { exact: true })).toBeVisible();

    await dialog.locator(".ai-history-wrap>summary").click();
    await dialog.getByRole("button", { name: "Hội thoại mới", exact: true }).click();
    await expect(dialog.getByText("Hôm nay bạn cần hỗ trợ gì?", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Hội thoại QA", exact: true }).click();
    await expect(dialog.getByText("Đã thực hiện", { exact: true })).toBeVisible();
    await dialog.locator(".ai-history-wrap>summary").click();
    check(true, "New conversation and private history work inside quick panel");
    check(actions === 1, "Quick chat shares existing action confirmation flow");

    failSend = true;
    await prompt().fill("Giữ lại khi lỗi");
    await prompt().press("Enter");
    await expect(dialog.getByRole("alert")).toHaveText("Không thể kết nối trợ lý QA");
    await expect(prompt()).toHaveValue("Giữ lại khi lỗi");
    failSend = false;
    check(true, "Provider error keeps draft for retry");

    await dialog.getByRole("link", { name: "Mở trang Trợ lý AI", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/1\/ai\?conversation=/);
    await expect(page.getByRole("heading", { name: "Trợ lý AI", exact: true })).toBeVisible();
    await expect(page.locator(".workspace-ai:not(.ai-compact)").getByText("Đã thực hiện", { exact: true })).toBeVisible();
    await expect(launcher).toHaveCount(0);
    check(true, "Expand opens same persisted conversation without duplicate launcher");
    await page.locator(".admin-sidebar").getByRole("link", { name: "Sản phẩm", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(prompt()).toHaveValue("Giữ lại khi lỗi");
    await expect(dialog.getByText("Đã thực hiện", { exact: true })).toBeVisible();

    for (const width of [1440, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 740 : 1000 });
      await expect(prompt()).toBeVisible();
      const box = await dialog.boundingBox();
      const sendBox = await dialog.getByRole("button", { name: "Gửi yêu cầu", exact: true }).boundingBox();
      const navBox = await page.locator(".app-bottom-nav").isVisible() ? await page.locator(".app-bottom-nav").boundingBox() : null;
      check(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && sendBox.x + sendBox.width <= width, `${engine.name()}: panel/composer fits ${width}px`);
      check(!navBox || box.y + box.height <= navBox.y, `${engine.name()}: chat clears mobile navigation at ${width}px`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${engine.name()}: no horizontal page overflow at ${width}px`);
      await page.screenshot({ path: `${out}/${engine.name()}-${width}.png` });
    }
    // Emulate the visualViewport dimensions dispatched by a mobile keyboard.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 390 });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect.poll(async () => (await dialog.boundingBox()).height).toBeLessThan(390);
    check((await dialog.boundingBox()).y >= 0, "Keyboard viewport resize keeps panel and composer inside visible area");
    await page.screenshot({ path: `${out}/${engine.name()}-keyboard.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await minimize();
    access = { ...access, allowed: true, reason: "", plan: "Khởi đầu", limit: 50 };
    await launcher.click();
    await expect(dialog.locator(".ai-quick-quota")).toContainText("Khởi đầu");
    await expect(prompt()).toBeEnabled();
    check(true, "Starter plan can use quick chat with a visible monthly quota");
    await minimize();
    access = { ...access, allowed: false, reason: "Gói dịch vụ hiện tại chưa hỗ trợ trợ lý AI.", plan: "Gói khác" };
    await launcher.click();
    await expect(dialog.getByText("Trợ lý chưa khả dụng", { exact: true })).toBeVisible();
    await expect(prompt()).toHaveCount(0);
    check(true, "Unknown plan sees entitlement message without composer");
    await minimize();
    access = { ...access, allowed: true, operational: false, reason: "Cửa hàng đang đóng băng" };
    await launcher.click();
    await expect(dialog.getByText("Cửa hàng đang đóng băng", { exact: true })).toBeVisible();
    await expect(prompt()).toHaveCount(0);
    check(true, "Frozen store cannot use quick chat");
    await minimize();
    access = { ...access, operational: true, enabled: false };
    await launcher.click();
    await expect(prompt()).toBeDisabled();
    check(true, "Store AI kill switch disables composer");
    await minimize();
    access = { ...access, enabled: true, used: 50 };
    await launcher.click();
    await expect(dialog.getByRole("button", { name: "Gửi yêu cầu", exact: true })).toBeDisabled();
    const before = writes.length;
    await prompt().press("Enter");
    check(writes.length === before, "Quota exhaustion blocks Enter as well as send button");

    identity = { ...identity, id: 999992 };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(launcher).toBeVisible();
    await expect(dialog).toHaveCount(0);
    access = { ...access, used: 0 };
    await launcher.click();
    await expect(prompt()).toHaveValue("");
    await expect(dialog.getByText("Giữ lại khi lỗi", { exact: true })).toHaveCount(0);
    check(true, "Account change destroys previous draft/transcript widget state");
    identity = { ...identity, role: "editor" };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toHaveCount(0);
    check(true, "Editor role has no launcher or retained conversation");
    check(errors.length === 0, "No browser runtime errors: " + errors.join("; "));
    check(writes.every(p => /^\/api\/workspace\/ai\/(chat|actions\/)/.test(p)), "No unexpected writes; all QA actions intercepted");
    check(tenantHeaders.length > 0 && tenantHeaders.every(Boolean), "Every AI request retains current workspace tenant header");
    await context.close();
  } finally { await browser.close(); }
}
await writeFile(`${out}/report.json`, JSON.stringify({ checks: report.length, report }, null, 2));
console.log(`Passed ${report.length} widget UI checks (API fixtures, no live provider).`);
