import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";

const origin=process.env.TEST_ORIGIN||'http://localhost:3000';
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin),'Local UI only');
const out='.local/manual-address-qa';await mkdir(out,{recursive:true});
let checks=0;const check=(v,t)=>{assert(v,t);checks++;console.log('PASS',t);};
const description='1002 Đường Láng, Đống Đa, Hà Nội';
const point={lat:21.0245,lng:105.8028};
for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',reducedMotion:'reduce',...(engine===webkit?{isMobile:true,hasTouch:true}:{})});
  const original={customerName:'Khách QA',phone:'0901234567',email:'',deliveryMode:'self',recipientName:'Người nhận QA',recipientPhone:'0901234568',deliveryDate:'2026-10-25',deliverySlot:'09:00–12:00',address:'',items:[{type:'custom',name:'Bó hoa QA',price:100000,quantity:1,size:'S',description:'Hoa kiểm thử',image:''}],collectAmount:0,collectMethod:'cash',discountType:'none',discountValue:0,adjustmentReason:'',shipping:0,code:'',tags:[],initialStatus:'pending',internalNotes:'',message:'',notes:''};
  let payload={...original},enabled=true,radius=true,failSearch=false,failDetail=false;
  const saves=[],quotes=[],creates=[],maps=[],errors=[];
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;let data=[],status=200;
   if(path==='/api/auth/me')data={user:{id:999999,role:'owner',name:'Address QA',email:'address@example.test',memberships:[]}};
   else if(path.endsWith('/notifications'))data={items:[]};
   else if(path==='/api/workspace/manual-orders/options')data={features:{goong:enabled},requiresCoordinates:radius,settings:{slots:['09:00–12:00']},capabilities:{create:true,adjust:true,collect:true,confirm:true},currentUserId:999999,staff:[{id:999999,name:'Address QA'}]};
   else if(path==='/api/workspace/order-drafts/900001'){
    if(req.method()==='PATCH'){payload=req.postDataJSON();saves.push(payload);}
    data={id:900001,status:'draft',version:1,payload};
   }else if(path==='/api/workspace/manual-orders/quote'){
    quotes.push(req.postDataJSON());data={items:[],total:100000,subtotal:100000,discount:0,shipping:0,token:'qa'};
   }else if(path==='/api/workspace/manual-orders'){
    creates.push(req.postDataJSON());status=409;data={error:'QA: đã kiểm tra payload, không tạo đơn thật.'};
   }else if(path.startsWith('/api/goong/')){
    maps.push({path,store:req.headers()['x-fleur-store']});
    if((path.endsWith('/search')&&failSearch)||(path.endsWith('/detail')&&failDetail)){status=502;data={error:'Goong QA unavailable'};}
    else data=path.endsWith('/search')?{predictions:[{place_id:'qa-hanoi',description}]}:{result:{geometry:{location:point}}};
   }
   await route.fulfill({status,json:data});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const address=()=>page.getByLabel('Địa chỉ giao hoa',{exact:true});
  const choose=async locator=>engine===webkit?locator.tap():locator.click();
  const open=async()=>{await page.goto(origin+'/workspace/1/orders/new?draft=900001');await expect(address()).toBeVisible();};
  const select=async(text='1002 Láng')=>{await address().fill(text);await choose(page.getByRole('option',{name:description,exact:true}));await expect(address()).toHaveValue(description);await expect(page.getByText('Đã chọn vị trí giao hoa.',{exact:false})).toBeVisible();};
  await open();await select();
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await expect.poll(()=>saves.length).toBe(1);
  check(payload.address===description&&payload.deliveryLat===point.lat&&payload.deliveryLng===point.lng,`${engine.name()}: Goong selection saves address and numeric coordinates together`);
  await page.reload();await expect(address()).toHaveValue(description);await expect(page.getByText('Đã chọn vị trí giao hoa.',{exact:false})).toBeVisible();
  check(true,`${engine.name()}: reopening draft restores selected delivery point`);
  await page.getByRole('radio',{name:'Gửi hoa tới người khách thương',exact:true}).check();
  await select('1002 Đường Láng');
  await page.getByRole('button',{name:'Tính giá & rà soát',exact:true}).click();
  await expect(page.getByRole('button',{name:'Tạo đơn hàng',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Tạo đơn hàng',exact:true}).click();await expect.poll(()=>creates.length).toBe(1);
  check(creates[0].address===description&&creates[0].deliveryLat===point.lat&&creates[0].deliveryLng===point.lng&&creates[0].deliveryMode==='gift',`${engine.name()}: gift review and final create carry the selected point`);
  await address().fill('12 Địa chỉ khác, Hà Nội');
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await expect.poll(()=>saves.length).toBe(2);
  check(!Object.hasOwn(payload,'deliveryLat')&&!Object.hasOwn(payload,'deliveryLng'),`${engine.name()}: editing address clears old coordinates from draft payload`);
  await page.getByRole('button',{name:'Tính giá & rà soát',exact:true}).click();
  await expect(page.locator('.manual-error[role="alert"]')).toContainText('chọn địa chỉ trong gợi ý');
  check(true,`${engine.name()}: radius-limited store requires a selected point before review`);
  failDetail=true;await address().fill('1002 Láng');await choose(page.getByRole('option',{name:description,exact:true}));
  await expect(page.getByRole('status').filter({hasText:'Chưa lấy được vị trí địa chỉ'})).toBeVisible();
  check(true,`${engine.name()}: failed place details explain retry without fake coordinates`);
  failDetail=false;failSearch=true;
  await address().fill('Địa chỉ tìm kiếm lỗi');
  await expect(page.getByRole('status').filter({hasText:'Chưa tìm được vị trí'})).toBeVisible();
  check(true,`${engine.name()}: search errors preserve manual address input`);
  failSearch=false;
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:950});await address().fill('1002 Láng '+width);
   const suggestion=page.getByRole('option',{name:description,exact:true});await expect(suggestion).toBeVisible();
   await suggestion.scrollIntoViewIfNeeded();
   check(await suggestion.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),`${engine.name()}: suggestion fits ${width}px`);
   await page.screenshot({path:`${out}/${engine.name()}-${width}.png`});
   await choose(suggestion);await expect(address()).toHaveValue(description);
   await expect(page.getByLabel('Vĩ độ',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Kinh độ',{exact:true})).toHaveCount(0);
  }
  check(maps.every(m=>m.store==='1'),`${engine.name()}: Goong requests keep current store scope`);
  enabled=false;radius=false;payload={...original};await open();const before=maps.length;
  await address().fill('12 Địa chỉ nhập tay, Hà Nội');await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await expect.poll(()=>saves.length).toBe(3);
  check(maps.length===before&&payload.address==='12 Địa chỉ nhập tay, Hà Nội',`${engine.name()}: unconfigured Goong retains manual entry without API requests`);
  await expect(address()).toHaveAttribute('autocomplete','street-address');
  check(!errors.length,`${engine.name()}: no runtime errors: ${errors.join('; ')}`);
 }finally{await browser.close();}
}
await writeFile(`${out}/report.json`,JSON.stringify({checks,provider:'mocked; no real orders or messages'},null,2));
console.log(`${checks} manual address UI checks passed`);
