import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html','utf8');

test('mobile HOT state uses integrated takeover UI instead of floating overlay',()=>{
  assert.match(html,/\.hotToast\s*\{\s*display:\s*none\s*!important/);
  assert.match(html,/id="mobileTakeover"/);
  assert.match(html,/class="mobileTakeoverCopy"/);
  assert.match(html,/ChatView|chatView/);
  assert.match(html,/classList\.toggle\("isHot",\s*c\?\.state === "HOT"\)/);
  assert.match(html,/\.chatView\.isHot \.composer/);
  assert.match(html,/\.hotStrip \.takeBtn\s*\{\s*display:\s*none\s*!important/);
});

test('HOT mobile header stays clean and accidental close is suppressed',()=>{
  assert.match(html,/closeChatAction/);
  assert.match(html,/\.chatView\.isHot \.closeChatAction\s*\{\s*display:\s*none\s*!important/);
  assert.match(html,/\.chatHead #takeBtn\s*\{\s*display:\s*none\s*!important/);
});
