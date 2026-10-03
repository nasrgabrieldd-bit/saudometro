import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// These fixtures run only in intercepted test responses, never in shipped app files.
const origin=process.env.TEST_URL || 'http://127.0.0.1:5187';
const channel=process.env.TEST_BROWSER_CHANNEL;
const browser=await chromium.launch({headless:true,...(channel?{channel}:{})});
const context=await browser.newContext({serviceWorkers:'block'});
context.setDefaultTimeout(10000);
for(let attempt=0;attempt<50;attempt++){try{const r=await fetch(origin);if(r.ok)break;}catch{} if(attempt===49)throw new Error('Inicie npm run dev antes dos testes desktop.');await new Promise(resolve=>setTimeout(resolve,100));}
await mkdir('test-results',{recursive:true});
const today=new Date().toISOString().slice(0,10);
const profile={id:'test-user',user_id:'test-user',couple_id:'test-couple',role:'gabriel',display_name:'Pessoa de teste'};
const group={id:'test-group',name:'Turma de teste',myDisplayName:'Pessoa de teste',colorKey:'azul',createdAt:today};
let notes=[];
const calls=[];
const errors=[];
let dialogs=[];

async function fixture(scope,name,args) {
 calls.push({scope,name,args});
 if(name==='isAnonymousUser'||name==='isNetworkError')return false;
 if(name==='getCoupleSettings')return {features:{tour:{gabriel:true,tata:true},home_order:['kiss','mood','goal','next'],mood:true},names:{gabriel:'Pessoa de teste',tata:'Par de teste'}};
 if(name==='getPartnerProfile')return {...profile,id:'test-partner',role:'tata',display_name:'Par de teste'};
 if(name==='getCoupleMeta')return {created_at:today};
 if(name==='ensureMonthPlan')return scope==='db'?{base_target:2,carry_in:0}:{target:2};
 if(name==='getCoupleStats')return {last_kiss_at:new Date(Date.now()-86400000).toISOString()};
 if(name==='getCoinBalances'||name==='getGameCoinsEarnedByRole'||name==='getGameProgressBothRoles')return {gabriel:20,tata:12};
 if(name==='getGroupCoinBalance')return 32;
 if(name==='getGameProgress')return 1;
 if(name==='getGoogleLinkStatus')return {linked:true};
 if(name==='getMyCouplePlan')return {plan:null};
 if(name==='getLatestRechargePeriod'||name==='getCycle')return null;
 if(name==='listMyFriendGroups')return [];
 if(name==='listGroupMembers')return [{user_id:'test-user',display_name:'Pessoa de teste'},{user_id:'test-friend',display_name:'Amigo de teste'}];
 if(name==='getGameCoinsEarnedByUser')return {'test-user':2};
 if(name==='getGameProgressAllMembers')return [{user_id:'test-user',current_level:1}];
 if(name==='getExistingSession')return null;
 if(name==='listRecentSweetNotes')return notes;
 if(name==='sendSweetNote') {
  notes=[{id:'test-note',role:args[1],message:args[2],created_at:new Date().toISOString()},...notes];
  setTimeout(()=>{for(const page of context.pages())page.evaluate(()=>window.__coupleRefresh?.({table:'sweet_notes'})).catch(()=>{});},50);
  return null;
 }
 if(name==='getGameBestTimes')return {};
 if(/^(list|get.*History|get.*Days|getMoods|getChallenge)/.test(name))return [];
 if(name==='signInWithGoogle'||name==='linkGoogleIdentity')return {error:null};
 if(/^(create|send|add|record|update|save|set|advance)/.test(name))return null;
 if(name==='getCustomPerks')return [];
 return [];
}

await context.addInitScript(()=>{
 window.__fixtureCall=async (scope,name,args)=>{
  const response=await fetch('/__desktop_test_api__',{method:'POST',body:JSON.stringify({scope,name,args})});return response.json();
 };
});
await context.route('**/__desktop_test_api__',async route=>{
 const {scope,name,args}=route.request().postDataJSON();
 await route.fulfill({json:await fixture(scope,name,args)});
});
for(const scope of ['db','friends']) {
 const source=await readFile(`js/${scope}.js`,'utf8');
 const names=[...source.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
 const body=names.map(name=>name==='subscribeCoupleChanges'
 ? `export function ${name}(id,callback){window.__coupleRefresh=callback;return ()=>{window.__coupleRefresh=null;};}`
 : name==='subscribeFriendGameChanges'
 ? `export function ${name}(){return ()=>{};}`
 : name==='isNetworkError'
 ? `export function ${name}(){return false;}`
 : `export async function ${name}(...args){return window.__fixtureCall('${scope}','${name}',args);}`).join('\n');
 await context.route(`**/js/${scope}.js`,route=>route.fulfill({contentType:'text/javascript',body}));
}
await context.route('**/js/supabaseClient.js',route=>route.fulfill({contentType:'text/javascript',body:`export const isConfigured=true;export const SUPABASE_URL='https://example.invalid';export const supabase={rpc:async()=>({data:null,error:null}),auth:{getSession:async()=>({data:{session:null}})}};`}));
await context.route('**/js/changelog.js',route=>route.fulfill({contentType:'text/javascript',body:'export const unseenChangelogFor=()=>[];export const markChangelogSeen=()=>{};'}));
await context.route('**/js/app.js',async route=>{
 let source=await readFile('js/app.js','utf8');
 source=source.replace(/\nboot\(\);\s*$/,`\nwindow.__desktopTest={State,enterApp,enterFriendsMode,setActiveTab,setFriendsTab,renderGoogleGate,renderNotesHistory,renderStarBattleGame,renderGameHub,closeModal};`);
 await route.fulfill({contentType:'text/javascript',body:source});
});
await context.route('**/*.supabase.co/**',route=>route.abort());
async function pageForCouple(width=1440) {
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.dismiss();});
 await page.setViewportSize({width,height:900});
 await page.goto(origin);
 await page.waitForFunction(()=>window.__desktopTest);
 await page.evaluate(async profile=>{
  window.__desktopTest.State.userId=profile.user_id;
  await window.__desktopTest.enterApp(profile);
 },profile);
 await page.locator('#kiss-clickzone').waitFor();
 return page;
}
async function assertFits(page) {
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
 const overflow=await page.locator('#screen-app:visible #view-container, #screen-friends:visible #friends-view').evaluateAll(els=>els.map(el=>({id:el.id,overflow:el.scrollWidth-el.clientWidth})));
 assert.ok(overflow.every(el=>el.overflow<=1),JSON.stringify(overflow));
}
try {
 const page=await pageForCouple();
 console.log('Authenticated UI fixtures loaded.');
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const width of [390,768,1024,1366,1920]) {
   await page.setViewportSize({width,height:900}); await assertFits(page);
   const navBox=await page.locator('#screen-app .bottom-nav').boundingBox();
   if(width>=1024){assert.ok(navBox.height>500);assert.ok(navBox.width<250);}
   else assert.ok(navBox.height<150);
  }
 }
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'test-results/casal-home-desktop.png',fullPage:true});
 await page.locator('#screen-app [data-tab="calendar"]').click();
 assert.equal(await page.locator('#screen-app [aria-current=page]').getAttribute('data-tab'),'calendar');
 await page.locator('#day-grid .day-cell:not(.empty)').first().waitFor();
 await page.locator('#day-grid .day-cell:not(.empty)').first().click();
 const board=await page.locator('.calendar-board').boundingBox();
 const detail=await page.locator('#day-detail').boundingBox();
 assert.ok(detail.x>board.x+board.width,'calendar must show details beside board');
 assert.ok(Math.abs(detail.y-board.y)<2,'calendar board and details align');
 await assertFits(page);
 await page.screenshot({path:'test-results/casal-calendar-desktop.png',fullPage:true});
 await page.locator('#screen-app [data-tab="notes"]').click();
 await page.locator('#btn-send-note').waitFor();
 await page.screenshot({path:'test-results/casal-notes-desktop.png',fullPage:true});
 for(const width of [390,768,1024,1440]){await page.setViewportSize({width,height:900});await assertFits(page);}
 await page.setViewportSize({width:1440,height:900});
 await page.locator('#btn-send-note').click();
 await page.locator('.modal-sheet').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
 const modal=await page.locator('.modal-sheet').boundingBox();
 assert.ok(modal.y>=0 && modal.y+modal.height<=900,'modal stays within viewport');
 for(const width of [390,768,1024,1440]){await page.setViewportSize({width,height:900});const box=await page.locator('.modal-sheet').boundingBox();assert.ok(box.width<=width+1 && box.y>=-1 && box.y+box.height<=901,JSON.stringify({width,box}));}
 const second=await pageForCouple(390);
 await second.locator('#screen-app [data-tab="notes"]').click();
 await second.locator('#btn-notes-history').waitFor();
 await second.locator('#btn-notes-history').click();
 await second.locator('.empty-state').waitFor();
 await page.locator('#sweet-note-text').fill('Recado de teste entre duas telas');
 await page.locator('#btn-send-sweet-note').click();
 await second.getByText('"Recado de teste entre duas telas"').waitFor();
 assert.ok(calls.some(c=>c.name==='sendSweetNote'&&c.args[0]==='test-couple'),'existing persistence contract');
 await page.locator('#screen-app [data-tab="mood"]').click();
 await page.locator('#save-mood').waitFor();
 await assertFits(page);
 await page.locator('#screen-app [data-tab="shop"]').click();
 await page.locator('.shortcut-card[data-view="perks"]').waitFor();
 await page.locator('.shortcut-card[data-view="perks"]').click();
 await page.locator('[data-act="redeem"]').first().waitFor();
 assert.equal(await page.locator('#view-container').getAttribute('data-layout'),'shop-perks');
 await assertFits(page);
 await page.locator('#btn-shop-back').click();
 await page.evaluate(()=>window.__desktopTest.renderStarBattleGame('casal'));
 await page.locator('.sbg-board').waitFor();
 assert.equal(await page.locator('#view-container').getAttribute('data-layout'),'game');
 assert.ok((await page.locator('.sbg-board').boundingBox()).width<=381,'game board preserves size');
 await page.screenshot({path:'test-results/casal-game-desktop.png',fullPage:true});
 await page.evaluate(async group=>window.__desktopTest.enterFriendsMode(group),group);
 await page.locator('#friends-home-mood-card').waitFor();
 await page.screenshot({path:'test-results/turma-home-desktop.png',fullPage:true});
 for(const width of [390,768,1024,1366,1920]){await page.setViewportSize({width,height:900});await assertFits(page);}
 await page.setViewportSize({width:1440,height:900});
 await page.locator('[data-friends-tab="roles"]').click();
 await page.locator('#friends-day-grid .day-cell:not(.empty)').first().waitFor();
 await page.locator('#friends-day-grid .day-cell:not(.empty)').first().click();
 assert.ok((await page.locator('#friends-day-detail').boundingBox()).x>(await page.locator('#friends-day-grid').boundingBox()).x,'group calendar detail beside grid');
 await page.screenshot({path:'test-results/turma-calendar-desktop.png',fullPage:true});
 await page.locator('[data-friends-tab="mood"]').click();await page.locator('#friends-set-mood-btn').waitFor();await assertFits(page);
 await page.locator('[data-friends-tab="notes"]').click();await page.locator('#friends-new-find-btn').waitFor();await assertFits(page);
 await page.locator('[data-friends-tab="shop"]').click();
 await page.locator('#btn-open-star-battle-friends').waitFor();await assertFits(page);
 await page.locator('#btn-open-star-battle-friends').click();await page.locator('#friends-view .sbg-board').waitFor();
 assert.equal(await page.locator('#friends-view').getAttribute('data-layout'),'game');
 // Real Google gate handler under isolated service fixtures; no actual OAuth account is used.
 const gate=await context.newPage();await gate.goto(origin);await gate.waitForFunction(()=>window.__desktopTest);
 await gate.evaluate(()=>window.__desktopTest.renderGoogleGate());
 assert.ok(await gate.locator('#btn-google-gate').isDisabled());
 await gate.locator('#age-confirm').check();await gate.locator('#btn-google-gate').click();
 assert.ok(calls.some(c=>c.name==='signInWithGoogle'));
 assert.ok(calls.filter(c=>c.scope==='friends' && ['getGroupCoinBalance','listEventsForMonth','listGroupMembers'].includes(c.name)).every(c=>c.args[0]==='test-group'),'group data stays scoped to group');
 assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 console.log('PASS: Casal/Turma responsive layouts, navigation, calendars, modals, notes with simulated shared persistence, shops, original game board and Google gate handler.');
} finally {await browser.close();}

