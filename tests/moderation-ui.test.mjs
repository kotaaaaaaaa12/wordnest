import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const origin='https://wordnest.example',password='moderation-admin-password';
const instance=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:password}}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check,label){for(let i=0;i<600;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(label);}
function memoryStorage(){const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function snapshot(storage){return Object.fromEntries(Array.from({length:storage.length},(_,i)=>{const key=storage.key(i);return [key,storage.getItem(key)];}));}
async function fixtureParticipant(mf){
  const saved=memoryStorage(),tracker=new statistics.LearningTracker({storage:saved}),ranking=new rankingTools.RankingClient({storage:saved,fetch:(path,options)=>mf.dispatchFetch(origin+path,options),snapshot:()=>({epoch:tracker.epoch,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,days:tracker.snapshot().days})});tracker.addTime(Date.now()-5000,Date.now());tracker.answer(true);await ranking.join('Bad <b>Name</b>');return {saved,ranking,tracker};
}
async function browser(mf,{lang='en',hash='#/',saved={['wordnest-ranking-v1']:JSON.stringify({choice:'declined'})}}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:origin+'/'+hash,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  let cookie='';w.fetch=async(path,options={})=>{const response=await mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});const session=response.headers.get('set-cookie');if(session)cookie=session.split(';')[0];return response;};
  for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,value);w.localStorage.setItem('wordnest-language',lang);
  const find=s=>w.document.querySelector(s);
  async function click(selector){assert.ok(find(selector),selector);find(selector).click();await tick();await tick();}
  function input(selector,value){find(selector).value=value;find(selector).dispatchEvent(new w.Event('input',{bubbles:true}));}
  function submit(selector){find(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
  w.eval(source);await waitFor(()=>!!find('.app-shell') && !find('.loading'),'page load');await tick();
  return {w,find,click,input,submit,expire(){cookie='';}};
}
test('password-gated Administration removes a participant, queues a private notice on another tab, and allows a renamed return',async()=>{
  const mf=instance(),fixture=await fixtureParticipant(mf);let admin,user,returning,confirmed;
  try{
    admin=await browser(mf,{hash:'#/guide'});assert.equal(admin.find('.nav [data-nav="admin"]'),null);assert.equal(admin.find('#guide-admin'),null);
    admin.w.location.hash='#/admin';await waitFor(()=>admin.w.location.hash==='#/','anonymous direct link');
    await admin.click('[data-action="settings"]');admin.input('#admin-password',password);admin.submit('#admin-login-form');await waitFor(()=>admin.find('[data-admin-lock]'),'administrator login');
    assert.deepEqual([...admin.w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.dataset.nav),['home','stats','rankings','guide','edit','admin']);
    await admin.click('[data-dialog="cancel"]');await admin.click('.nav [data-nav="guide"]');assert.ok(admin.find('#guide-admin'));await admin.click('.nav [data-nav="admin"]');await waitFor(()=>admin.find('.admin-participant'),'learner list');admin.find('#admin-status').value='listed';admin.find('#admin-status').dispatchEvent(new admin.w.Event('change',{bubbles:true}));await waitFor(()=>admin.find('.admin-person-head h2')?.textContent==='Bad <b>Name</b>','listed participant');assert.equal(admin.w.document.title,'Wordnest — Administration');assert.equal(admin.find('.admin-person-head h2').textContent,'Bad <b>Name</b>');assert.equal(admin.find('.admin-person-head h2 b'),null);
    admin.input('#admin-search','Bad');await waitFor(()=>!admin.find('[data-action="admin-refresh"]').disabled,'search');
    await admin.click('[data-action="admin-stats"]');await waitFor(()=>admin.find('.admin-stats-view [data-stat]'),'individual statistics');
    assert.equal(admin.find('.admin-stats-name').textContent,'Bad <b>Name</b>');assert.equal(admin.find('.admin-stats-name b'),null);assert.equal(admin.w.document.querySelectorAll('.admin-stats-view .stat-card').length,8);
    assert.equal(admin.find('[data-stat="answeredQuestions"]').textContent,'1');assert.equal(admin.find('[data-stat="accuracy"]').textContent,'100%');
    assert.notEqual(admin.w.document.activeElement,admin.find('[data-action="admin-stats-back"]'),'detail buttons do not receive programmatic focus');
    await admin.click('[data-action="settings"]');admin.find('#settings-language').value='ja';admin.find('#settings-language').dispatchEvent(new admin.w.Event('change',{bubbles:true}));
    assert.equal(admin.find('[data-action="admin-stats-back"]').textContent.trim(),messages.ja.adminBack);assert.equal(admin.find('.admin-stats-view h1').textContent,'学習記録');assert.equal(admin.find('[data-stat="currentStreak"]').textContent,'1日');
    admin.find('#settings-language').value='en';admin.find('#settings-language').dispatchEvent(new admin.w.Event('change',{bubbles:true}));
    await admin.click('[data-dialog="cancel"]');await admin.click('[data-action="admin-stats-back"]');assert.equal(admin.find('#admin-search').value,'Bad');assert.ok(admin.find('.admin-participant'));
    // Leaving a detail before its request completes must not restore private results.
    const originalFetch=admin.w.fetch;let releaseStats,statsStarted=false;
    admin.w.fetch=async(path,options)=>{const response=await originalFetch(path,options);if(path.endsWith('/stats') && path.startsWith('/api/admin/')){statsStarted=true;await new Promise(resolve=>{releaseStats=resolve;});}return response;};
    await admin.click('[data-action="admin-stats"]');await waitFor(()=>statsStarted,'delayed statistics request');await admin.click('[data-action="admin-stats-back"]');releaseStats();await tick();await tick();
    assert.equal(admin.find('.admin-stats-view'),null);assert.equal(admin.find('#admin-search').value,'Bad');admin.w.fetch=originalFetch;
    user=await browser(mf,{hash:'#/guide',saved:snapshot(fixture.saved)});await user.click('[data-action="settings"]');assert.equal(user.find('#modal-title').textContent,'Settings');
    await admin.click('[data-action="admin-remove"]');admin.submit('#moderation-form');assert.equal(admin.find('#moderation-error').hidden,false);assert.equal(admin.find('#moderation-error').textContent,messages.en.invalidRankingMessage);await admin.click('[data-moderation-close]');assert.ok(admin.find('.admin-participant'));
    await admin.click('[data-action="admin-remove"]');const reason='掲載名が不適切です。\n<script>名前を変更してください。</script>';admin.input('#moderation-ja',reason);admin.submit('#moderation-form');await waitFor(()=>!admin.find('#modal').open && !admin.find('.admin-participant'),'participant removal');
    user.w.dispatchEvent(new user.w.Event('online'));await waitFor(()=>JSON.parse(user.w.localStorage.getItem(rankingTools.RANKING_KEY)).notice,'notice received');assert.equal(user.find('#modal-title').textContent,'Settings','an existing modal is not replaced');
    await user.click('[data-dialog="cancel"]');await waitFor(()=>user.find('.moderation-notice'),'queued notification');assert.equal(user.find('#modal-title').textContent,messages.en.rankingRemovedTitle);assert.equal(user.find('.moderation-notice').textContent,reason);assert.equal(user.find('.moderation-notice').getAttribute('lang'),'ja');assert.equal(user.find('.moderation-notice script'),null);assert.equal(user.find('.nav [data-nav="admin"]'),null);
    await user.click('[data-notice-later]');assert.equal(user.find('#modal').open,false);const deferred=snapshot(user.w.localStorage);assert.equal(JSON.parse(deferred[rankingTools.RANKING_KEY]).notice.acknowledged,false);
    await user.click('.nav [data-nav="rankings"]');await waitFor(()=>!user.find('.ranking-loading'),'deferred participation');await user.click('[data-action="ranking-name"]');await waitFor(()=>user.find('.moderation-notice'),'review notice before rejoining on same visit');await user.click('[data-notice-later]');assert.equal(user.find('#ranking-name-form'),null);
    returning=await browser(mf,{lang:'ja',hash:'#/stats',saved:deferred});await waitFor(()=>returning.find('.moderation-notice'),'notice after next visit');assert.equal(returning.find('#modal-title').textContent,'ランキングから削除されました');assert.equal(returning.find('[data-stat="answeredQuestions"]').textContent,'1');
    await returning.click('[data-notice-confirm]');await waitFor(()=>!returning.find('#modal').open,'notice acknowledgement');assert.equal(JSON.parse(returning.w.localStorage.getItem(rankingTools.RANKING_KEY)).notice.acknowledged,true);
    confirmed=await browser(mf,{lang:'ja',hash:'#/guide',saved:snapshot(returning.w.localStorage)});await new Promise(resolve=>setTimeout(resolve,60));assert.equal(confirmed.find('.moderation-notice'),null);assert.equal(confirmed.find('#modal').open,false);
    admin.find('#admin-status').focus();admin.find('#admin-status').value='removed';admin.find('#admin-status').dispatchEvent(new admin.w.Event('change',{bubbles:true}));await waitFor(()=>admin.find('.admin-messages'),'removed list');assert.notEqual(admin.w.document.activeElement.tagName,'SELECT');assert.equal(admin.find('.admin-messages dd').textContent,reason);assert.equal(admin.find('.admin-person-head .pill').textContent,messages.en.noticeRead);
    await admin.click('[data-action="admin-stats"]');await waitFor(()=>admin.find('.admin-stats-view [data-stat]'),'removed statistics retained');assert.equal(admin.find('.admin-stats-view [data-stat="answeredQuestions"]').textContent,'1');await admin.click('[data-action="admin-stats-back"]');
    await returning.click('.nav [data-nav="rankings"]');await waitFor(()=>!returning.find('.ranking-loading'),'rankings');await returning.click('[data-action="ranking-name"]');returning.input('#ranking-name','Bad <b>Name</b>');returning.submit('#ranking-name-form');await waitFor(()=>!returning.find('#ranking-name-error').hidden,'unchanged name rejected');assert.equal(returning.find('#ranking-name-error').textContent,messages.ja.rankingNameUnchanged);
    returning.input('#ranking-name','Clean name');returning.submit('#ranking-name-form');await waitFor(()=>!returning.find('#modal').open && !returning.find('.ranking-loading'),'renamed rejoin');assert.equal(returning.find('.ranking-name').textContent,'Clean name');assert.equal(JSON.parse(returning.w.localStorage.getItem(rankingTools.RANKING_KEY)).id,fixture.ranking.preferences().id);
    admin.input('#admin-search','');await waitFor(()=>!admin.find('[data-action="admin-refresh"]').disabled,'clear search');admin.find('#admin-status').value='listed';admin.find('#admin-status').dispatchEvent(new admin.w.Event('change',{bubbles:true}));await waitFor(()=>admin.find('.admin-person-head h2')?.textContent==='Clean name','rejoined participant listed');
    // An expired management request immediately removes private rows and both administrator tabs.
    await admin.click('[data-action="admin-stats"]');await waitFor(()=>admin.find('.admin-stats-view [data-stat]'),'rejoined statistics');
    admin.expire();await admin.click('[data-action="admin-stats-refresh"]');await waitFor(()=>admin.w.location.hash==='#/','expired administrator redirected');assert.equal(admin.find('.nav [data-nav="admin"]'),null);assert.equal(admin.find('.nav [data-nav="edit"]'),null);assert.equal(admin.find('.admin-messages'),null);assert.equal(admin.find('.admin-stats-view'),null);assert.equal(admin.find('[data-stat]'),null);
  }finally{admin?.w.close();user?.w.close();returning?.w.close();confirmed?.w.close();await mf.dispose();}
});

test('Administration searches private learners and shows all eight records without publishing them',async()=>{
  const mf=instance(),fixture=await fixtureParticipant(mf);let admin;
  try{
    await fixture.ranking.decline('Private learner');
    admin=await browser(mf);await admin.click('[data-action="settings"]');admin.input('#admin-password',password);admin.submit('#admin-login-form');await waitFor(()=>admin.find('[data-admin-lock]'),'administrator login');await admin.click('[data-dialog="cancel"]');await admin.click('.nav [data-nav="admin"]');
    await waitFor(()=>admin.find('#admin-status'),'all learners');assert.equal(admin.find('#admin-status').value,'all');
    admin.input('#admin-search','Private learner');await waitFor(()=>admin.find('.admin-person-head h2')?.textContent==='Private learner' && !admin.find('[data-action="admin-refresh"]').disabled,'private name search');
    assert.equal(admin.find('[data-action="admin-remove"]'),null);assert.equal(admin.find('.admin-person-actions .pill').textContent,messages.en.adminPrivate);
    admin.find('#admin-status').value='private';admin.find('#admin-status').dispatchEvent(new admin.w.Event('change',{bubbles:true}));await waitFor(()=>admin.find('.admin-participant') && !admin.find('[data-action="admin-refresh"]').disabled,'private filter');
    await admin.click('[data-action="admin-stats"]');await waitFor(()=>admin.find('.admin-stats-view [data-stat]'),'private detail');assert.equal(admin.find('.admin-stats-name').textContent,'Private learner');assert.equal(admin.w.document.querySelectorAll('.admin-stats-view [data-stat]').length,8);assert.equal(admin.find('[data-stat="answeredQuestions"]').textContent,'1');
    fixture.tracker.answer(false);await fixture.ranking.sync(true);await admin.click('[data-action="admin-stats-refresh"]');await waitFor(()=>admin.find('[data-stat="answeredQuestions"]')?.textContent==='2','private record update');
    await admin.click('[data-action="admin-stats-back"]');assert.equal(admin.find('#admin-search').value,'Private learner');assert.equal(admin.find('#admin-status').value,'private');
    const board=await mf.dispatchFetch(origin+'/api/rankings?metric=answered&self='+fixture.ranking.preferences().id);const data=await board.json();assert.equal(data.mine,null);assert.equal(data.rows.length,0);
  }finally{admin?.w.close();await mf.dispose();}
});
test('administrator history shows the selected private learner’s chart and calendar, with separate selections and participant-local dates',async()=>{
  const mf=instance(),first=await fixtureParticipant(mf),second=await fixtureParticipant(mf);let admin;
  try{
    const old=new Date(2024,1,29,10).getTime();first.tracker.addTime(old,old+900000);for(let i=0;i<4;i++)first.tracker.answer(i<3,old);for(let i=0;i<5;i++)first.tracker.flip(old);await first.ranking.sync(true);await first.ranking.decline('Private history');
    second.tracker.reset();await second.ranking.sync(true);await second.ranking.decline('No history');
    const zone='Pacific/Kiritimati',db=await mf.getD1Database('DB'),firstId=first.ranking.preferences().id,secondId=second.ranking.preferences().id;await db.prepare('UPDATE ranking_profiles SET timezone=? WHERE id=?').bind(zone,firstId).run();
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    admin=await browser(mf);admin.w.Date.now=()=>Date.now()-86400000*2;
    const localStart=new Date(2025,0,10,10).getTime();admin.w.localStorage.setItem('wordnest-learning-v1:admin-only-history',JSON.stringify({version:1,days:{'2025-01-10':{answered:99,correct:99,flips:99,intervals:[[localStart,localStart+1800000]]}}}));
    await admin.click('[data-action="settings"]');admin.input('#admin-password',password);admin.submit('#admin-login-form');await waitFor(()=>admin.find('[data-admin-lock]'),'administrator login');await admin.click('[data-dialog="cancel"]');await admin.click('.nav [data-nav="admin"]');await waitFor(()=>admin.find('[data-action="admin-stats"][data-id="'+firstId+'"]'),'private learner listed');
    await admin.click('[data-action="admin-stats"][data-id="'+firstId+'"]');await waitFor(()=>admin.find('.study-calendar'),'participant history');
    assert.equal(admin.w.document.querySelectorAll('.stats-bars li').length,7);assert.equal(admin.w.document.querySelectorAll('.stats-bars time')[6].dateTime,today);assert.equal(admin.find('.calendar-day.is-today time').dateTime,today);assert.notEqual(today,statistics.localDay(admin.w.Date.now()));assert.equal(admin.find('[data-action="calendar-today"]'),null);
    assert.equal(admin.find('[data-stat="answeredQuestions"]').textContent,'5');assert.equal(admin.find('[data-day-stat="answeredQuestions"]').textContent,String(first.tracker.snapshot().days[today]?.answered || 0));
    const thisMonth=today.slice(0,7);let cursor=thisMonth;while(cursor>'2024-02'){await admin.click('[data-action="calendar-month"][data-offset="-1"]');cursor=admin.find('.calendar-grid time').dateTime.slice(0,7);}
    assert.equal(admin.w.document.querySelectorAll('.calendar-day').length,29);await admin.click('[data-date="2024-02-29"]');assert.equal(admin.find('[data-day-stat="totalTime"]').textContent,'15m 0s');assert.equal(admin.find('[data-day-stat="answeredQuestions"]').textContent,'4');assert.equal(admin.find('[data-day-stat="correctQuestions"]').textContent,'3');assert.equal(admin.find('[data-day-stat="accuracy"]').textContent,'75%');assert.equal(admin.find('[data-day-stat="cardFlips"]').textContent,'5');
    await admin.click('[data-action="admin-stats-refresh"]');await waitFor(()=>admin.find('.study-calendar'),'history reload');assert.equal(admin.find('#calendar-selected-title time').dateTime,'2024-02-29');
    await admin.click('[data-action="settings"]');admin.find('#settings-language').value='ja';admin.find('#settings-language').dispatchEvent(new admin.w.Event('change',{bubbles:true}));await admin.click('[data-dialog="cancel"]');assert.equal(admin.find('#calendar-title').textContent.trim(),'学習カレンダー');assert.match(admin.find('#recent-time').textContent,/直近7日間/);assert.equal(admin.find('#calendar-selected-title time').dateTime,'2024-02-29');
    await admin.click('.nav [data-nav="stats"]');assert.equal(admin.find('[data-stat="answeredQuestions"]').textContent,'99');assert.equal(admin.find('.calendar-day.is-today time').dateTime,statistics.localDay(admin.w.Date.now()));assert.equal(admin.find('[data-action="calendar-today"]'),null);
    await admin.click('.nav [data-nav="admin"]');await waitFor(()=>admin.find('[data-action="admin-stats"][data-id="'+secondId+'"]'),'second learner');await admin.click('[data-action="admin-stats"][data-id="'+secondId+'"]');await waitFor(()=>admin.find('.study-calendar'),'empty history');assert.equal(admin.find('[data-stat="answeredQuestions"]').textContent,'0');assert.ok(admin.find('.calendar-empty'));assert.equal(admin.find('[data-offset="-1"]').disabled,true);assert.ok(admin.w.document.querySelectorAll('.stats-bars .bar-value').length===7);assert.ok([...admin.w.document.querySelectorAll('.stats-bars .bar-value')].every(element=>element.textContent==='0秒'));
    admin.expire();await admin.click('[data-action="admin-stats-refresh"]');await waitFor(()=>!admin.find('.nav [data-nav="admin"]'),'expired admin session');assert.equal(admin.find('.study-calendar'),null);
  }finally{admin?.w.close();await mf.dispose();}
});
