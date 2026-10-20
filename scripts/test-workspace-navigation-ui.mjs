import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin), "Local UI only");
const out = ".local/workspace-navigation-qa";
await mkdir(out, { recursive: true });
const checks = [];
const check = (ok, label) => { assert(ok, label); checks.push(label); console.log("PASS", label); };
const order = ["overview","analytics","board","calendar","orders","refunds","crm","ai","inquiries","products","categories","promotions","emails","automations","events","posts","theme","users","settings","billing","audit"];
const rights = {
  owner: order,
  admin: order.filter(key => !["theme","settings","billing"].includes(key)),
  manager: order.filter(key => !["posts","theme","users","settings","billing","audit"].includes(key)),
  editor: ["events","posts"],
  support: ["board","calendar","orders","refunds","crm","ai","inquiries","emails"],
};
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    let role = "owner", notice = { pending_invoices: 2, days_remaining: 3 };
    const errors = [], requests = [];
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      requests.push({ path, method: request.method(), store: request.headers()["x-fleur-store"] });
      let data = [];
      if (path === "/api/auth/me") data = { user: { id: 999998, name: "Menu QA", email: "menu@example.test", role, memberships: [] } };
      else if (path.endsWith("/notifications")) data = { items: [] };
      else if (path === "/api/admin/overview") data = { stats: {}, revenue: [], recent: [], top: [] };
      else if (path === "/api/workspace/navigation-summary") data = { billing: notice };
      else if (request.method() !== "GET") data = { ok: true };
      await route.fulfill({ json: data });
    });
    const page = await context.newPage();
    // Let Next's prefetch/navigation finish before a test forces a new document.
    // Aborting RSC requests mid-navigation produces WebKit access-control errors.
    const navigate = async url => {
      await page.waitForLoadState('networkidle');
      await page.goto(url);
      await page.waitForLoadState('networkidle');
    };
    page.on("pageerror", error => errors.push(error.message));
    let documents = 0;
    page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
    await navigate(origin + "/workspace/1/overview");
    const nav = page.getByRole("navigation", { name: "Điều hướng workspace" });
    await expect(nav.locator("a")).toHaveCount(21);
    check(JSON.stringify(await nav.locator("a").evaluateAll(links => links.map(a => a.pathname.split('/').at(-1)))) === JSON.stringify(order), `${engine.name()}: exact workflow priority for all 21 links`);
    await expect(nav.locator('.workspace-nav-group')).toHaveCount(4);
    await expect(nav.getByRole('region',{name:'Vận hành hằng ngày'}).getByRole('button')).toHaveCount(0);
    await expect(nav.getByRole('link',{name:'Bảng xử lý đơn',exact:true})).toHaveAttribute('href','/workspace/1/board');
    await expect(nav.getByRole('link',{name:'Danh sách đơn hàng',exact:true})).toHaveAttribute('href','/workspace/1/orders');
    check(true,`${engine.name()}: daily group stays open and renamed order links retain tenant routes`);
    await expect(page.locator('.workspace-billing-notice')).toContainText('còn 3 ngày');
    await expect(nav.locator('.workspace-billing-badge')).toHaveText('2');
    check(requests.filter(r=>r.path==='/api/workspace/navigation-summary').every(r=>r.method==='GET'&&r.store==='1'),`${engine.name()}: owner billing summary uses read-only scoped requests`);
    check(!requests.some(r=>r.path==='/api/workspace/billing'),`${engine.name()}: menu never loads the billing reconciliation endpoint`);
    const marketing = nav.getByRole('button',{name:'Tiếp thị & nội dung',exact:true});
    await marketing.focus(); await page.keyboard.press('Enter');
    await expect(marketing).toHaveAttribute('aria-expanded','false');
    await expect(nav.getByRole('link',{name:'Tin tức',exact:true})).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(marketing).toHaveAttribute('aria-expanded','false');
    check(true,`${engine.name()}: group toggles by keyboard and remembers preference after reload`);
    await navigate(origin+'/workspace/1/posts');
    await expect(marketing).toHaveAttribute('aria-expanded','true');
    await expect(nav.getByRole('link',{name:'Tin tức',exact:true})).toHaveAttribute('aria-current','page');
    check(true,`${engine.name()}: direct links automatically reveal the current group`);
    const documentCount = documents;
    await nav.getByRole('link',{name:'Sản phẩm',exact:true}).click();
    await page.waitForURL(origin+'/workspace/1/products');
    await expect(nav.getByRole('link',{name:'Sản phẩm',exact:true})).toHaveAttribute('aria-current','page');
    check(documents===documentCount,`${engine.name()}: menu navigation does not reload the document`);
    await page.getByRole('button',{name:'Thu gọn thanh menu',exact:true}).click();
    await expect(page.locator('.admin-shell')).toHaveClass(/sidebar-collapsed/);
    await expect(nav.getByRole('link',{name:'Tin tức',exact:true})).toBeVisible();
    await expect(nav.getByRole('link',{name:'Tin tức',exact:true})).toHaveAttribute('title','Tin tức');
    check(await nav.locator('a').first().evaluate(link=>link.getBoundingClientRect().width<70),`${engine.name()}: compact rail exposes every allowed icon with tooltips`);
    await page.getByRole('button',{name:'Mở rộng thanh menu',exact:true}).click();
    await expect(marketing).toHaveAttribute('aria-expanded','false');
    check(true,`${engine.name()}: expanding rail restores group preferences`);
    for (const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:900});
      if(width<=700) await page.getByRole('button',{name:'Mở menu quản trị',exact:true}).click();
      await expect(nav).toBeVisible();
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine.name()}: no page overflow at ${width}px`);
      check(await nav.evaluate(el=>el.scrollWidth<=el.clientWidth),`${engine.name()}: groups fit sidebar at ${width}px`);
      await page.screenshot({path:`${out}/${engine.name()}-${width}.png`});
      if(width<=700){
        await nav.getByRole('link',{name:'Tổng quan',exact:true}).click();
        await page.waitForURL(origin+'/workspace/1/overview');
        await expect(page.locator('.admin-sidebar')).not.toHaveClass(/mobile-open/);
        await page.getByRole('button',{name:'Mở menu quản trị',exact:true}).click();
        await expect(page.locator('.sidebar-mobile-close')).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('.admin-user button')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('.sidebar-mobile-close')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button',{name:'Mở menu quản trị',exact:true})).toBeFocused();
        check(true,`${engine.name()}: mobile selection, focus trap and Escape work at ${width}px`);
      }
    }
    await page.setViewportSize({width:1440,height:1000});
    for (const candidate of ['admin','manager','editor','support']) {
      role=candidate;
      await page.evaluate(()=>localStorage.removeItem('fleurious.workspace.menu-groups.v1'));
      const before = requests.filter(r=>r.path==='/api/workspace/navigation-summary').length;
      await navigate(origin+'/workspace/1/overview');
      await expect(nav.locator('a')).toHaveCount(rights[candidate].length);
      check(JSON.stringify(await nav.locator('a').evaluateAll(links=>links.map(a=>a.pathname.split('/').at(-1))))===JSON.stringify(rights[candidate]),`${engine.name()}: ${candidate} retains exact allowed items in priority order`);
      check(await nav.locator('.workspace-nav-group').evaluateAll(groups=>groups.every(group=>group.querySelectorAll('a').length>0)),`${engine.name()}: ${candidate} sees no empty groups`);
      await expect(page.locator('.workspace-billing-notice')).toHaveCount(0);
      check(requests.filter(r=>r.path==='/api/workspace/navigation-summary').length===before,`${engine.name()}: ${candidate} never fetches owner billing data`);
      if(!rights[candidate].includes('overview')) await expect(page.getByRole('link',{name:'Mở workspace của bạn',exact:true})).toHaveAttribute('href','/workspace/1/'+rights[candidate][0]);
    }
    role='owner';notice={pending_invoices:0,days_remaining:null};
    await navigate(origin+'/workspace/1/overview');
    await expect(nav.locator('a')).toHaveCount(21);
    await expect(page.locator('.workspace-billing-notice')).toHaveCount(0);
    await expect(nav.locator('.workspace-billing-badge')).toHaveCount(0);
    check(!errors.length,`${engine.name()}: no runtime errors: ${errors.join('; ')}`);
  } finally { await browser.close(); }
}
await writeFile(`${out}/report.json`,JSON.stringify({checks:checks.length,details:checks},null,2));
console.log(`${checks.length} workspace navigation UI checks passed`);
