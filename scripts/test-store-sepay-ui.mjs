import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";

// All requests are intercepted: no real key, bank call or store setting is changed.
const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
await mkdir(".local/store-sepay-ui", { recursive: true });
let checks = 0;
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({viewport:{width,height:1000},serviceWorkers:"block",reducedMotion:"reduce",...(engine === webkit ? {isMobile:true,hasTouch:true} : {})});
      let configured = false, enabled = false, key = "", mainSaves = 0;
      const errors = [], writes = [];
      const page = await context.newPage();
      page.on("pageerror", e => errors.push(e.message));
      const settings = {shipping:35000,free_shipping:1000000,lead_minutes:60,advance_days:30,capacity:20,slots:["09:00–12:00"],closed_dates:[],open:true};
      await context.route("**/api/**", async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        let data = [];
        if (path === "/api/auth/me") data = {user:{id:999,name:"SePay UI Owner",email:"sepay-ui@example.test",role:"owner",memberships:[]},ghost:null};
        else if (path.endsWith("/notifications")) data = {items:[]};
        else if (path === "/api/activity") data = {ok:true};
        else if (path === "/api/workspace/settings") {
          if (req.method() === "PATCH") {mainSaves++; data = {ok:true};}
          else data = {id:1,name:"SePay UI QA",phone:"0901234567",address:"10 Phố Hoa, Hà Nội",radius_km:10,status:"approved",version:1,settings,bank:{bank_code:"TPB",bank_name:"TPBank",account_number:"123456789",account_holder:"QA",enabled:true,sepay_enabled:true,auto_confirm_status:"confirmed"}};
        } else if (path === "/api/workspace/sepay/credentials") {
          if (req.method() === "POST") {
            const b = req.postDataJSON();
            assert(!configured || b.replace === true);
            key = b.apiKey || "flr_sepay_QA_" + "x".repeat(configured ? 44 : 43);
            configured = true; enabled = true;
            data = {ok:true,apiKey:key};
          } else data = {configured,enabled,api_last4:key.slice(-4),webhookUrl:origin+"/api/sepay/webhook/stores/1"};
        } else if (path === "/api/workspace/sepay/disable") {enabled=false;data={ok:true};}
        else if (req.method() !== "GET") {writes.push(path);await route.fulfill({status:400,json:{error:"Unexpected write"}});return;}
        await route.fulfill({status:200,json:data});
      });
      await page.goto(origin + "/admin/settings");
      const panel = page.getByRole("region", {name:"Kết nối SePay cửa hàng"});
      await expect(panel.getByText("Chưa cấu hình", {exact:true})).toBeVisible();
      await expect(panel.getByLabel("Webhook URL", {exact:true})).toHaveValue(origin+"/api/sepay/webhook/stores/1");
      await panel.getByRole("button",{name:"Tạo kết nối SePay",exact:true}).click();
      await expect(panel.getByLabel("API key vừa lưu", {exact:true})).toHaveAttribute("type","password");
      await expect(panel.getByText("Đã cấu hình", {exact:true})).toBeVisible();
      await panel.getByRole("button", {name:"Hiện API key",exact:true}).click();
      await expect(panel.getByLabel("API key vừa lưu", {exact:true})).toHaveAttribute("type","text");
      await page.reload();
      await expect(panel.getByRole("button",{name:"Đổi API key",exact:true})).toBeVisible();
      await expect(panel.getByLabel("API key vừa lưu", {exact:true})).toHaveCount(0);
      const oldKey = key;
      const customKey = "QA_custom_webhook_" + "z".repeat(30);
      await panel.getByLabel("API key webhook (tùy chọn)", {exact:true}).fill(customKey);
      await panel.getByRole("button",{name:"Đổi API key",exact:true}).click();
      assert.equal(key,oldKey,"Key cannot rotate until explicit confirmation");
      await panel.getByRole("button",{name:"Xác nhận",exact:true}).click();
      await expect(panel.getByLabel("API key vừa lưu",{exact:true})).toHaveValue(customKey);
      await panel.getByRole("button",{name:"Tắt kết nối",exact:true}).click();
      await panel.getByRole("button",{name:"Xác nhận",exact:true}).click();
      await expect(panel.getByText("Đã tắt",{exact:true})).toBeVisible();
      await expect(panel.getByLabel("API key vừa lưu",{exact:true})).toHaveCount(0);
      assert.equal(mainSaves,0,"Integration buttons must not submit the parent store settings form");
      const overflowing = await panel.locator("input,button").evaluateAll(elements => elements.filter(el => {
        const r=el.getBoundingClientRect();return r.width>0 && (r.left<0 || r.right>innerWidth+1);
      }).length);
      assert.equal(overflowing,0,"Inputs and buttons must fit the viewport");
      assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1),"No horizontal page overflow");
      await panel.screenshot({path:`.local/store-sepay-ui/${engine.name()}-${width}.png`});
      assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
      checks++;
      console.log(`PASS ${engine.name()} ${width}px: URL, generation, masking, reload, custom key, confirmation, disable, containment`);
      await context.close();
    }
  } finally {await browser.close();}
}
console.log(`PASS ${checks} SePay UI scenarios; all APIs mocked`);
