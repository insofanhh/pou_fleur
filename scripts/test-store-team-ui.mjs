import assert from "node:assert/strict";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { chooseSelect, nativeSelect } from "./ui-controls.mjs";

const expect = baseExpect.configure({ timeout: 15000 });
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
await mkdir(".local/screenshots", { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of engine === chromium ? [1440, 390, 320] : [390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const errors = [],
        writes = [];
      let role = "owner",
        fail = false,
        delayed = false,
        release;
      let members = [
        {
          id: 98101,
          name: "Nguyễn An",
          email: "owner@example.test",
          role: "owner",
          status: "active",
        },
        {
          id: 98102,
          name: "Trần Minh Anh",
          email: "minhanh.verylongemail@example.test",
          role: "manager",
          status: "active",
        },
        {
          id: 98103,
          name: "Lê Thảo",
          email: "thao@example.test",
          role: "support",
          status: "revoked",
        },
      ];
      let invitations = [
        {
          id: 98104,
          email: "invited@example.test",
          role: "editor",
          status: "pending",
          expires_at: "2099-12-01T10:00:00Z",
        },
        {
          id: 98105,
          email: "expired@example.test",
          role: "support",
          status: "pending",
          expires_at: "2020-01-01T10:00:00Z",
        },
      ];
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route("**/api/**", async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname;
        let data = [];
        if (req.method() !== "GET") {
          const body = req.postDataJSON();
          writes.push({ path, body });
          if (fail)
            return route.fulfill({
              status: 400,
              json: { error: "Không thể cập nhật nhân sự QA" },
            });
          if (delayed)
            await new Promise((resolve) => {
              release = resolve;
            });
          if (path === "/api/workspace/team/invite") {
            invitations.unshift({
              id: 98106,
              ...body,
              status: "pending",
              expires_at: "2099-12-01T10:00:00Z",
            });
            data = { url: "/join?token=qa-only-invitation" };
          } else {
            members = members.map((m) =>
              path.endsWith("/" + m.id) ? { ...m, ...body } : m,
            );
            data = { ok: true };
          }
        } else if (path === "/api/auth/me")
          data = {
            user: { ...members[0], role, memberships: [] },
            ghost: null,
          };
        else if (path === "/api/workspace/team")
          data = { members, invitations };
        else if (path.endsWith("/notifications")) data = { items: [] };
        await route.fulfill({ status: 200, json: data });
      });
      await page.goto(origin + "/admin/users");
      const root = page.locator(".store-team-page");
      await expect(
        root.getByRole("heading", { name: "Nhân sự cửa hàng" }),
      ).toBeVisible();
      await expect(root).not.toContainText(/\bID\b|9810[1-6]/);
      await expect(root.locator("tbody tr")).toHaveCount(3);
      await expect(root.getByText("Đã hết hạn", { exact: true })).toBeVisible();
      assert.equal(
        await root
          .getByRole("combobox", { name: "Vai trò của Nguyễn An" })
          .count(),
        0,
      );
      async function fits() {
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "page overflows at " + width,
        );
        const clipped = await root
          .locator(
            ".ui-select-trigger, .table-action, .store-team-identity, .store-team-invitation-top",
          )
          .evaluateAll((nodes) =>
            nodes.some((n) => n.getBoundingClientRect().right > innerWidth + 1),
          );
        assert.equal(clipped, false, "content clips at " + width);
      }
      await fits();
      await page.screenshot({
        path: `.local/screenshots/store-team-${engine.name()}-${width}.png`,
        fullPage: true,
      });
      await chooseSelect(
        nativeSelect(root, "Vai trò của Trần Minh Anh"),
        "editor",
      );
      await expect(nativeSelect(root, "Vai trò của Trần Minh Anh")).toHaveValue(
        "editor",
      );
      await expect(
        root.getByRole("button", { name: "Thu hồi quyền của Trần Minh Anh" }),
      ).toBeEnabled();
      assert(
        writes.some(
          (w) =>
            w.path.endsWith("/98102") &&
            w.body.role === "editor" &&
            w.body.status === "active",
        ),
      );
      await root
        .getByRole("button", { name: "Thu hồi quyền của Trần Minh Anh" })
        .click();
      await expect(
        root.getByRole("button", { name: "Kích hoạt quyền của Trần Minh Anh" }),
      ).toBeEnabled();
      await root
        .getByRole("button", { name: "Kích hoạt quyền của Trần Minh Anh" })
        .click();
      await expect(
        root.getByRole("button", { name: "Thu hồi quyền của Trần Minh Anh" }),
      ).toBeEnabled();
      fail = true;
      await root
        .getByRole("button", { name: "Kích hoạt quyền của Lê Thảo" })
        .click();
      await expect(
        page.getByText("Không thể cập nhật nhân sự QA", { exact: true }),
      ).toBeVisible();
      await expect(
        root.getByRole("button", { name: "Kích hoạt quyền của Lê Thảo" }),
      ).toBeEnabled();
      fail = false;
      const form = root.locator("form");
      await form
        .getByRole("textbox", { name: "Email", exact: true })
        .fill("new@example.test");
      await chooseSelect(nativeSelect(form, "Vai trò"), "support");
      delayed = true;
      await form
        .getByRole("button", { name: "Tạo lời mời", exact: true })
        .click();
      await expect(
        form.getByRole("button", { name: "Đang tạo lời mời…" }),
      ).toBeDisabled();
      await expect(
        form.getByRole("textbox", { name: "Email", exact: true }),
      ).toBeDisabled();
      await expect.poll(() => typeof release).toBe("function");
      release();
      delayed = false;
      await expect(form.getByRole("link")).toHaveAttribute(
        "href",
        origin + "/join?token=qa-only-invitation",
      );
      await expect(root.locator(".store-team-invitation-list")).toContainText(
        "new@example.test",
      );
      assert.equal(writes.filter((w) => w.path.endsWith("/invite")).length, 1);
      assert.deepEqual(writes.at(-1).body, {
        email: "new@example.test",
        role: "support",
      });
      await fits();
      // Reload as a store admin: existing read-only permissions remain intact.
      role = "admin";
      invitations = [];
      await page.reload();
      await expect(
        root.getByText("Chưa có lời mời nào.", { exact: false }),
      ).toBeVisible();
      assert.equal(
        await root.locator("form, .table-action, [role=combobox]").count(),
        0,
      );
      await fits();
      assert.deepEqual(errors, []);
      console.log(
        `PASS store staff UI, permissions, mutations, invitation and overflow: ${engine.name()} ${width}px`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
