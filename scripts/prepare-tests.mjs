import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/browser-ui-smoke.test.mjs';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`prepare-tests: pattern missing: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
  "    json(res,404,{error:'not_found'});",
  "    if (path === '/favicon.ico' || path === '/.well-known/appspecific/com.chrome.devtools.json') { res.writeHead(204); return res.end(); }\n    json(res,404,{error:'not_found'});",
  'auxiliary Chromium paths',
);
replaceOnce(
  "      await page.getByTitle('Einstellungen').first().click(); await expectVisible(page,'#settingsModal'); await page.locator('#settingsModal .modalHead button').click();\n      await page.getByTitle('Profile verwalten').click(); await expectVisible(page,'#profilesModal'); await page.locator('#profilesModal .modalHead button').click();",
  "      if(cfg.name==='desktop'){await page.getByTitle('Einstellungen').first().click();await expectVisible(page,'#settingsModal');await page.locator('#settingsModal .modalHead button').click();await page.getByTitle('Profile verwalten').click();await expectVisible(page,'#profilesModal');await page.locator('#profilesModal .modalHead button').click();}else{const nav=page.locator('.mobileNav');await nav.getByText('Setup',{exact:false}).click();await expectVisible(page,'#settingsModal');await page.locator('#settingsModal .modalHead button').click();await nav.getByText('Profile',{exact:false}).click();await expectVisible(page,'#profilesModal');await page.locator('#profilesModal .modalHead button').click();}",
  'responsive modal controls',
);
replaceOnce(
  "    await page.getByTitle('Profile verwalten').click(); await page.getByText('Smoke Profil',{exact:false}).click(); await expectVisible(page,'#profileModal');",
  "    await page.getByTitle('Profile verwalten').click(); await page.locator('#profileRows button').filter({hasText:'Smoke Profil'}).first().click(); await expectVisible(page,'#profileModal');",
  'profile row selector one',
);
replaceOnce(
  "    await page.getByTitle('Profile verwalten').click(); await page.getByText('Smoke Profil',{exact:false}).first().click();",
  "    await page.getByTitle('Profile verwalten').click(); await page.locator('#profileRows button').filter({hasText:'Smoke Profil'}).first().click();",
  'profile row selector two',
);

writeFileSync(path, source);
console.log('prepare-tests: Chromium smoke harness normalized');
