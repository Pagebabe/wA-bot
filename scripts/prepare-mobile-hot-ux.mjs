import { readFileSync, writeFileSync } from 'node:fs';

const path = 'public/index.html';
let html = readFileSync(path, 'utf8');

if (!html.includes('.mobileTakeover{display:none}')) {
  html = html.replace('</style>', `.mobileTakeover{display:none}.mobileTakeoverCopy{min-width:0}.mobileTakeoverCopy b{display:block;font-size:13px}.mobileTakeoverCopy span{display:block;color:var(--muted);font-size:11px;margin-top:2px}@media(max-width:900px){.hotToast{display:none!important}.chatHead{height:auto;min-height:64px;padding:8px 10px;gap:8px}.chatHead #takeBtn{display:none!important}.chatView.isHot .closeChatAction{display:none!important}.hotStrip.show{display:block;padding:8px 12px;font-size:12px;line-height:1.35}.hotStrip .takeBtn{display:none!important}.chatView.isHot .composer,.chatView.isHot .quickBar{display:none!important}.chatView.isHot .mobileTakeover{display:flex}.mobileTakeover{align-items:center;gap:10px;background:#202c33;border-top:1px solid var(--line);padding:10px 12px calc(10px + env(safe-area-inset-bottom))}.mobileTakeoverCopy{flex:1}.mobileTakeover .takeBtn{flex:0 0 auto;min-width:132px;min-height:48px;font-size:15px;padding:10px 14px}.messages{padding-top:10px}.chatInfo b{font-size:15px}.chatInfo span{font-size:10px}}</style>`);
}

if (!html.includes('id="mobileTakeover"')) {
  const marker = '<footer class="composer">';
  if (!html.includes(marker)) throw new Error('prepare-mobile-hot-ux: composer marker missing');
  html = html.replace(marker, '<div id="mobileTakeover" class="mobileTakeover"><div class="mobileTakeoverCopy"><b>🔥 Bereit für Übernahme</b><span>KI ist gestoppt · du kannst jetzt antworten</span></div><button class="takeBtn" onclick="takeover()">Übernehmen</button></div>' + marker);
}

if (!html.includes('closeChatAction')) {
  html = html.replace('class="icon" title="Schließen" onclick="closeConversation()"', 'class="icon closeChatAction" title="Schließen" onclick="closeConversation()"');
}

if (!html.includes('function syncMobileHotUi()')) {
  const hook = `\nfunction syncMobileHotUi(){const view=$('chatView');const c=state.currentChat;if(!view)return;view.classList.toggle('isHot',c?.state==='HOT')}\nconst __renderChatHeaderMobile=renderChatHeader;renderChatHeader=()=>{__renderChatHeaderMobile();syncMobileHotUi()};syncMobileHotUi();\n`;
  if (!html.includes('</script>')) throw new Error('prepare-mobile-hot-ux: script end missing');
  html = html.replace('</script>', hook + '</script>');
}

writeFileSync(path, html);
console.log('prepare-mobile-hot-ux: mobile HOT handoff redesigned');
