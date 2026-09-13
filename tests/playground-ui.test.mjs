import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const serverSource = readFileSync('src/server.ts','utf8');
const html = readFileSync('public/index.html','utf8');

test('qualification playground route cannot send WhatsApp messages', () => {
  const start = serverSource.indexOf("app.post('/api/test/qualify'");
  const end = serverSource.indexOf("app.post('/api/conversations/:id/send-entry-photo'", start);
  assert.ok(start >= 0 && end > start, 'playground route missing');
  const route = serverSource.slice(start,end);
  assert.match(route,/qualifyLead/);
  assert.doesNotMatch(route,/sendText\s*\(/);
  assert.doesNotMatch(route,/sendVoiceAudio\s*\(/);
  assert.match(route,/text\.length > 4000/);
});

test('real browser: user can run AI playground from settings', async () => {
  const profile = {id:'p1',name:'Test Profil',connection:{status:'offline'},bot_enabled:true};
  const settings = {llm_base_url:'https://integrate.api.nvidia.com',llm_model:'nvidia/nemotron-3.5-lightning-30b-a3b',has_llm_key:true,llm_key_source:'environment',voice_enabled:false,voice_provider:'same-api',voice_model:'gpt-4o-mini-tts',ai_disclosure_enabled:true};
  const http = createServer((req,res)=>{
    const url = new URL(req.url,'http://127.0.0.1');
    const send=(code,obj)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj));};
    if(url.pathname==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html);}
    if(url.pathname==='/api/bootstrap') return send(200,{profiles:[profile],conversations:[],settings});
    if(url.pathname==='/api/test/qualify'&&req.method==='POST') return send(200,{ok:true,reply:'',hot:true,score:.93,reason:'Konkreter Terminwunsch'});
    if(url.pathname==='/favicon.ico'||url.pathname==='/.well-known/appspecific/com.chrome.devtools.json'){res.writeHead(204);return res.end();}
    return send(200,{ok:true});
  });
  await new Promise(r=>http.listen(0,'127.0.0.1',r));
  const port=http.address().port;
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
    await page.locator('.listTop .topActions button[title="Einstellungen"]').click();
    assert.equal(await page.locator('#settingsModal').isVisible(),true);
    assert.equal(await page.locator('#sKey').isDisabled(),true,'Railway secret field should be disabled');
    assert.equal(await page.locator('#sTestProfile').inputValue(),'p1');
    await page.locator('#sTestMessage').fill('Ich möchte heute um 20 Uhr einen Termin.');
    await page.locator('#playgroundBtn').click();
    await page.locator('#playgroundResult').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#playgroundResult')?.textContent?.includes('HOT'));
    const result=await page.locator('#playgroundResult').textContent();
    assert.match(result,/HOT/);
    assert.match(result,/93%/);
    assert.match(result,/Konkreter Terminwunsch/);
    assert.deepEqual(errors,[]);
  }finally{
    await browser.close();
    await new Promise(r=>http.close(r));
  }
});
