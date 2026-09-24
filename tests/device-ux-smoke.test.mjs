import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const html = readFileSync('public/index.html', 'utf8');
const now = () => new Date().toISOString();

function json(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
async function bodyJson(req){return new Promise(resolve=>{let data='';req.on('data',c=>data+=c);req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch{resolve({})}})})}

async function startMock(){
  let profiles=[{id:'p1',name:'Köln Profil',phone_label:'Köln 1',location:'Köln',desired_location:'Köln Innenstadt',price_text:'ab 80 €',hours_text:'10–22',status:'offline',connection:{status:'offline',qr:null},bot_enabled:true,system_prompt:'Kurz.',qualification_prompt:'Terminbereit ist HOT.',hot_threshold:.8,response_style:'kurz',max_ai_turns:8,handoff_behavior:'stop',voice_mode:'off',llm_model_override:null,temperature:.35,voice_name:'alloy',media:[],quick_replies:[]}];
  let conversations=[{id:'c-hot',profile_id:'p1',wa_jid:'49111@s.whatsapp.net',contact_name:'Anna Hot',state:'HOT',hot_score:.94,hot_reason:'Terminbereit',ai_turns:2,unread_count:2,last_message_preview:'Heute passt.',last_message_at:now()}];
  let messages={'c-hot':[{id:'m1',conversation_id:'c-hot',direction:'in',sender:'lead',kind:'text',text:'Heute passt.',created_at:now()}]};
  let settings={app_name:'wA-bot',llm_base_url:'https://integrate.api.nvidia.com',llm_model:'test-model',has_llm_key:true,voice_enabled:false,voice_provider:'same-api',voice_model:'tts',ai_disclosure_enabled:true};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'); const path=url.pathname;
    if(path==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html)}
    if(path==='/api/bootstrap'&&req.method==='GET')return json(res,200,{profiles,conversations,settings});
    if(path==='/api/settings/test'&&req.method==='POST')return json(res,200,{ok:true,status:200,text:'OK'});
    if(path==='/api/settings'&&req.method==='POST'){settings={...settings,...await bodyJson(req),has_llm_key:true};return json(res,200,{ok:true,settings})}
    const msgMatch=path.match(/^\/api\/conversations\/([^/]+)\/messages$/); if(msgMatch&&req.method==='GET')return json(res,200,{data:messages[msgMatch[1]]||[]});
    const action=path.match(/^\/api\/conversations\/([^/]+)\/(takeover|return-ai|close|send)$/); if(action&&req.method==='POST'){const c=conversations.find(x=>x.id===action[1]);if(!c)return json(res,404,{error:'not_found'});if(action[2]==='takeover')c.state='HUMAN_ACTIVE';if(action[2]==='return-ai')c.state='AI_ACTIVE';if(action[2]==='close')c.state='CLOSED';return json(res,200,c)}
    if(path==='/favicon.ico'||path==='/.well-known/appspecific/com.chrome.devtools.json'){res.writeHead(204);return res.end()}
    return json(res,404,{error:'not_found'});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address(); return{server,base:`http://127.0.0.1:${port}`};
}

async function launchPage(base,viewport){
  const executablePath=process.env.CHROMIUM_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/chromium-browser');
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport}); const consoleErrors=[];const pageErrors=[];const failed=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())}); page.on('pageerror',e=>pageErrors.push(e.message)); page.on('requestfailed',r=>failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText||''}`)); page.on('dialog',d=>d.accept());
  await page.goto(base+'/',{waitUntil:'networkidle'}); return{browser,page,consoleErrors,pageErrors,failed};
}

async function assertHitTarget(locator,label){
  assert.equal(await locator.isVisible(),true,`${label}: not visible`);
  const b=await locator.boundingBox(); assert.ok(b,`${label}: no box`);
  assert.ok(b.width>=28&&b.height>=28,`${label}: too small ${b.width}x${b.height}`);
  const covered=await locator.evaluate(el=>{const r=el.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const top=document.elementFromPoint(x,y);return !(top===el||el.contains(top))});
  assert.equal(covered,false,`${label}: center covered`);
}

const devices=[
  ['phone-320x568',320,568],['phone-360x800',360,800],['phone-390x844',390,844],['phone-412x915',412,915],
  ['tablet-768x1024',768,1024],['tablet-landscape-1024x768',1024,768],['laptop-1366x768',1366,768],['desktop-1440x900',1440,900],['desktop-1920x1080',1920,1080],
];

for(const [name,width,height] of devices){
  test(`device UX ${name}: top controls, click targets and fit`,async()=>{
    const mock=await startMock(); const ctx=await launchPage(mock.base,{width,height}); const {page,browser}=ctx;
    try{
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth); assert.ok(overflow<=1,`${name}: horizontal overflow ${overflow}px`);
      const topAdd=page.getByTitle('Profil hinzufügen'); const topSettings=page.getByTitle('Einstellungen').last();
      for(const [id,loc] of [['add-profile',topAdd],['settings',topSettings]]) await assertHitTarget(loc,`${name} ${id}`);

      if(width<=900){
        assert.equal(await page.locator('.mobileNav').isVisible(),true,`${name}: mobile nav missing`);
        for(const text of ['Chats','HOT','Profile','Setup']) await assertHitTarget(page.locator('.mobileNav button').filter({hasText:text}).first(),`${name} mobile ${text}`);
      }else{
        assert.equal(await page.locator('.rail').isVisible(),true,`${name}: desktop rail missing`);
        for(const title of ['Chats','HOT','Profile','Einstellungen']) await assertHitTarget(page.locator(`.rail button[title="${title}"]`),`${name} rail ${title}`);
      }

      await topAdd.click(); assert.equal(await page.locator('#profileModal').isVisible(),true,`${name}: add-profile modal did not open`); await assertHitTarget(page.locator('#profileModal .modalHead button'),`${name} profile-modal close`); await page.locator('#profileModal .modalHead button').click();
      await topSettings.click(); assert.equal(await page.locator('#settingsModal').isVisible(),true,`${name}: settings modal did not open`); await assertHitTarget(page.locator('#settingsModal .modalHead button'),`${name} settings-modal close`); await page.locator('#settingsModal .modalHead button').click();

      await page.getByText('Anna Hot',{exact:true}).click(); assert.equal(await page.locator('#chatView').isVisible(),true,`${name}: chat view did not open`);
      if(width<=900){
        assert.equal(await page.locator('#chatPane').evaluate(e=>e.classList.contains('mobileOpen')),true,`${name}: mobile chat pane did not open`); await page.waitForTimeout(240);
        await assertHitTarget(page.locator('#mobileTakeover .takeBtn'),`${name} mobile takeover`);
        assert.equal(await page.locator('.chatActions button[title="Schließen"]').isVisible(),false,`${name}: HOT close action should be hidden`);
        await assertHitTarget(page.locator('.backBtn'),`${name} mobile-back`);
      }else{
        await assertHitTarget(page.locator('#takeBtn'),`${name} takeover`); await assertHitTarget(page.locator('.chatActions button[title="Schließen"]'),`${name} close-chat`);
      }

      assert.deepEqual(ctx.pageErrors,[],`${name}: page errors ${ctx.pageErrors.join(' | ')}`); assert.deepEqual(ctx.consoleErrors,[],`${name}: console errors ${ctx.consoleErrors.join(' | ')}`); assert.deepEqual(ctx.failed,[],`${name}: failed requests ${ctx.failed.join(' | ')}`);
    }finally{await browser.close();await new Promise(resolve=>mock.server.close(resolve))}
  });
}
