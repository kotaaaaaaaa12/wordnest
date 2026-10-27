import {completeDeletionHold} from './management-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import {icon} from '../public/icons.js';
import {messages,translator} from '../public/i18n.js';
import * as zip from 'fflate';
import {seed} from './fixture.js';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,''),bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function harness(mf,lang='en'){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
 const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
 w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 let cookie='';w.fetch=async(path,options={})=>{const response=await mf.dispatchFetch('https://wordnest.example'+path,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});if(response.headers.has('Set-Cookie'))cookie=response.headers.get('Set-Cookie').split(';')[0];return response;};
 w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.localStorage.setItem('wordnest-sound','off');
 const find=selector=>w.document.querySelector(selector);
 async function until(check){for(let i=0;i<350;i++){if(check())return;await tick();}throw new Error('Timed out: '+check.toString()+'; '+find('#modal')?.textContent);}
 async function click(selector){const element=find(selector);assert.ok(element,selector);element.click();await tick();}
 function input(selector,value){const element=find(selector);assert.ok(element,selector);element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));}
 function submit(){find('#account-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
 w.eval(source);await until(()=>find('.set-card'));await tick();return {w,find,click,input,submit,until,close:()=>w.close()};
}
test('localized account forms transfer guest records, omit recovery codes, log in across browsers, separate ranking display names, and keep admin access separate',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'administrator-password'}}));let a,b;
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  a=await harness(mf,'ja');new statistics.LearningTracker({storage:a.w.localStorage,id:'guest-test'}).answer(true);
  await a.click('[data-action="account"]');assert.equal(a.find('#modal-title').textContent,'ログイン');assert.equal(a.find('#account-password').getAttribute('autocomplete'),'current-password');assert.equal(a.find('#account-start-title').textContent,messages.ja.accountStartTitle);assert.ok(a.find('.account-start-note').textContent.includes(messages.ja.accountStartOtherDevice));assert.ok(a.find('.account-start-note').textContent.includes(messages.ja.accountStartHere));await a.click('[data-account-close]');await a.click('[data-action="account"]');assert.equal(a.find('.account-start-note'),null,'the onboarding note is shown only on the first account visit');
  await a.click('[data-account-mode="register"]');a.input('#account-login-id','private_login');a.input('#account-password','a secure long passphrase');a.input('#account-confirm','different passphrase');a.input('#account-display-name','表示用の名前');a.submit();await a.until(()=>!a.find('#account-error').hidden);assert.equal(a.find('#account-error').textContent,messages.ja.accountPasswordMismatch);
  a.input('#account-confirm','a secure long passphrase');a.find('#account-listed').checked=true;a.submit();await a.until(()=>a.find('[data-account-command="logout"]'));assert.equal(a.find('.account-recovery-code'),null);assert.equal(a.find('[data-nav="edit"]'),null);
  assert.equal(a.find('[data-account-command="import"]').disabled,true);assert.ok(a.find('#modal').textContent.includes(messages.ja.accountNoGuestRecords));await a.click('[data-account-close]');await a.click('[data-nav="stats"]');assert.ok(a.find('.stats-note').textContent.includes('すべての端末'));assert.equal(a.find('[data-nav="admin"]'),null);
  b=await harness(mf);new statistics.LearningTracker({storage:b.w.localStorage,id:'other-browser-guest'}).answer(false);await b.click('[data-action="account"]');assert.equal(b.find('#account-start-title').textContent,messages.en.accountStartTitle);assert.ok(b.find('.account-start-note').textContent.includes(messages.en.accountStartOtherDevice));b.input('#account-login-id','PRIVATE_LOGIN');b.input('#account-password','a secure long passphrase');b.submit();await b.until(()=>b.find('[data-account-command="logout"]'));assert.equal(b.find('.account-id strong').textContent,'private_login');assert.equal(b.find('[data-account-command="import"]').disabled,false);await b.click('[data-account-command="sync"]');await b.until(()=>!b.find('[data-account-command="sync"]').disabled);assert.equal(b.find('[data-account-command="import"]').disabled,false,'sync does not import guest records');await b.click('[data-account-command="import"]');await b.until(()=>b.find('[data-account-command="import"]')?.disabled && b.find('#modal').textContent.includes(messages.en.accountNoGuestRecords));assert.ok(b.find('#modal').textContent.includes(messages.en.accountNoGuestRecords));assert.equal(b.w.localStorage.getItem('wordnest-learning-v1:other-browser-guest'),null);await b.click('[data-account-close]');await b.click('[data-nav="stats"]');assert.equal(b.find('.stats-note').textContent,messages.en.accountStatsHelp);
  await b.click('[data-nav="rankings"]');await b.until(()=>b.find('.rankings-view')?.textContent.includes('表示用の名前'));assert.ok(!b.find('.rankings-view').textContent.includes('private_login'));
  await b.click('[data-action="settings"]');assert.ok(b.find('#account-settings').textContent.includes('private_login'));assert.ok(b.find('.settings-data-note').textContent.includes('every synced device'));await b.click('[data-dialog="cancel"]');
  await b.click('[data-action="account"]');await b.until(()=>b.find('[data-account-mode="password"]'));await b.click('[data-account-mode="password"]');b.input('#account-current-password','a secure long passphrase');b.input('#account-password','a changed long passphrase');b.input('#account-confirm','a changed long passphrase');b.submit();await b.until(()=>b.find('[data-account-command="logout"]'));assert.equal(b.find('.account-recovery-code'),null);await b.click('[data-account-command="logout"]');await b.until(()=>!b.find('#modal').open);await b.click('[data-action="account"]');assert.equal(b.find('#modal-title').textContent,messages.en.accountLogin);await b.click('[data-account-mode="help"]');assert.ok(b.find('#modal').textContent.includes(messages.en.accountAdminRecoveryHelp));assert.equal(b.find('#account-form'),null);assert.equal(b.find('#account-recovery'),null);await b.click('[data-account-mode="login"]');assert.equal(b.find('#modal-title').textContent,messages.en.accountLogin);
 }finally{a?.close();b?.close();await mf.dispose();}
});
test('opening a deleted account switches the interface to a guest while preserving the learner name and statistics',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'administrator-password'}}));let a;
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  a=await harness(mf,'ja');const tracker=new statistics.LearningTracker({storage:a.w.localStorage,id:'guest-to-account-to-guest'});tracker.answer(true);tracker.answer(false);tracker.flip();
  await a.click('[data-action="account"]');await a.click('[data-account-mode="register"]');a.input('#account-login-id','deleted_browser');a.input('#account-password','a secure long passphrase');a.input('#account-confirm','a secure long passphrase');a.input('#account-display-name','元の名前');a.submit();await a.until(()=>a.find('[data-account-command="logout"]'));
  const {id}=JSON.parse(a.w.localStorage.getItem('wordnest-account-v1'));await a.click('[data-account-close]');await a.click('[data-nav="stats"]');assert.equal(a.find('[data-stat="answeredQuestions"]').textContent,'2');assert.equal(a.find('[data-stat="correctQuestions"]').textContent,'1');assert.equal(a.find('[data-stat="cardFlips"]').textContent,'1');
  const login=await mf.dispatchFetch('https://wordnest.example/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'administrator-password'})}),cookie=login.headers.get('Set-Cookie').split(';')[0];
  const deletion=await mf.dispatchFetch('https://wordnest.example/api/admin/accounts/'+id,{method:'DELETE',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({loginId:'deleted_browser'})});assert.equal(deletion.status,200);
  await a.click('[data-action="account"]');await a.until(()=>a.find('#account-form'));assert.equal(a.find('#modal-title').textContent,messages.ja.accountLogin);assert.equal(a.find('[data-account-command="logout"]'),null);assert.equal(JSON.parse(a.w.localStorage.getItem('wordnest-account-v1')),null);assert.equal(JSON.parse(a.w.localStorage.getItem('wordnest-ranking-v1')).name,'元の名前');assert.equal(a.find('.account-start-note'),null);
  await a.click('[data-account-close]');await a.click('[data-nav="stats"]');assert.equal(a.find('[data-stat="answeredQuestions"]').textContent,'2');assert.equal(a.find('[data-stat="correctQuestions"]').textContent,'1');assert.equal(a.find('[data-stat="cardFlips"]').textContent,'1');assert.ok(!a.find('.stats-note').textContent.includes(messages.ja.accountStatsHelp));
  await a.click('[data-action="account"]');await a.click('[data-account-mode="register"]');assert.equal(a.find('#account-display-name').value,'元の名前');
 }finally{a?.close();await mf.dispose();}
});
test('a permanently erased guest loses local statistics and name on reconnect without an automatic replacement or signup modal',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'administrator-password'}}));let a;
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  a=await harness(mf,'ja');const tracker=new statistics.LearningTracker({storage:a.w.localStorage,id:'erased-ui-guest'});tracker.answer(true);tracker.flip();
  const client=new rankingTools.RankingClient({storage:a.w.localStorage,fetch:a.w.fetch,snapshot:()=>({epoch:tracker.epoch,timezone:'UTC',days:tracker.snapshot().days})});await client.join('消すゲスト');const prefs=client.preferences();
  await a.click('[data-nav="stats"]');assert.equal(a.find('[data-stat="answeredQuestions"]').textContent,'1');await a.click('[data-action="settings"]');assert.ok(a.find('#modal').open);
  const login=await mf.dispatchFetch('https://wordnest.example/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'administrator-password'})}),cookie=login.headers.get('Set-Cookie').split(';')[0];
  const response=await mf.dispatchFetch('https://wordnest.example/api/admin/rankings/'+prefs.id,{method:'DELETE',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({name:prefs.name,loginId:null,confirmation:prefs.id.slice(0,12)})});assert.equal(response.status,200);await completeDeletionHold(mf,prefs.id);
  a.w.dispatchEvent(new a.w.Event('online'));await a.until(()=>JSON.parse(a.w.localStorage.getItem('wordnest-ranking-v1'))?.erased);await a.until(()=>!a.find('#modal').open);assert.equal(a.find('[data-stat="answeredQuestions"]').textContent,'0');assert.equal(a.find('[data-stat="cardFlips"]').textContent,'0');assert.equal(JSON.parse(a.w.localStorage.getItem('wordnest-ranking-v1')).name,undefined);
  a.w.dispatchEvent(new a.w.Event('online'));await new Promise(resolve=>setTimeout(resolve,50));assert.equal(a.find('#modal').open,false);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ranking_profiles').first()).n,0);
 }finally{a?.close();await mf.dispose();}
});
