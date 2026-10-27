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
test('administrators manage registered accounts by ID in both languages, confirm permanent deletion, and reset passwords without recovery codes',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'administrator-password'}}));let browser;
 const password='original learner password';
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  for(const lang of ['ja','en']){
   const loginId='account_'+lang,registration=await mf.dispatchFetch('https://wordnest.example/api/account/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginId,password,name:'Twin <b>name</b>',enabled:false,timezone:'UTC',entries:{}})}),{user}=await registration.json();
   browser=await harness(mf,lang);const {w,find,click,input,until}=browser;
   await click('[data-action="settings"]');input('#admin-password','administrator-password');find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>find('[data-nav="admin"]'));await click('[data-dialog="cancel"]');await click('[data-nav="admin"]');await until(()=>find('[data-action="admin-account"]'));
   input('#admin-search',loginId.toUpperCase());await until(()=>find('.admin-participant .admin-account-meta')?.textContent.includes(loginId));assert.ok(find('.admin-participant .account-type').textContent.includes(messages[lang].adminRegistered));assert.equal(find('.admin-participant b'),null,'display names are escaped');
   find('#admin-kind').value='guests';find('#admin-kind').dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>find('.empty'));assert.equal(find('[data-action="admin-account"]'),null);
   find('#admin-kind').value='accounts';find('#admin-kind').dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>find('[data-action="admin-account"]'));
   await click('[data-action="admin-stats"]');await until(()=>find('.admin-stats-view .admin-account-meta'));assert.ok(find('.admin-stats-view .admin-account-meta').textContent.includes(loginId));assert.ok(find('.study-calendar'));assert.ok(find('.stats-chart'));
   await click('[data-action="admin-account"]');assert.equal(find('#modal-title').textContent,messages[lang].adminAccountManage);assert.ok(find('#modal').textContent.includes(loginId));assert.equal(find('[autofocus]'),null);
   await click('[data-admin-account-mode="password"]');input('#admin-new-password','replacement learner password');input('#admin-confirm-password','different learner password');
   const submit=()=>find('#admin-account-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();await until(()=>!find('#admin-account-error').hidden);assert.equal(find('#admin-account-error').textContent,messages[lang].accountPasswordMismatch);
   input('#admin-confirm-password','replacement learner password');submit();await until(()=>!find('#modal').open);assert.equal(find('.account-recovery-code'),null);
   const login=await mf.dispatchFetch('https://wordnest.example/api/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginId,password:'replacement learner password'})});assert.equal(login.status,200);
   await click('[data-action="admin-account"]');await click('[data-admin-account-mode="delete"]');assert.ok(find('#modal').textContent.includes(messages[lang].adminDeleteAccountHelp));await click('[data-admin-account-close]');assert.ok(await db.prepare('SELECT id FROM accounts WHERE id=?').bind(user.id).first(),'cancel does not delete');
   await click('[data-action="admin-account"]');await click('[data-admin-account-mode="delete"]');input('#admin-confirm-login-id','wrong_id');submit();await until(()=>!find('#admin-account-error').hidden);assert.equal(find('#admin-account-error').textContent,messages[lang].accountConfirmId);assert.ok(await db.prepare('SELECT id FROM accounts WHERE id=?').bind(user.id).first());
   input('#admin-confirm-login-id',loginId);submit();await until(()=>!find('#modal').open && !find('.admin-stats-view'));await until(()=>find('.administration-view .empty'));assert.equal(await db.prepare('SELECT id FROM accounts WHERE id=?').bind(user.id).first(),null);assert.equal(find('[data-action="admin-account"]'),null);
   browser.close();browser=null;
  }
 }finally{browser?.close();await mf.dispose();}
});
test('permanent deletion is available for guests in both languages and requires a matching confirmation code',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'administrator-password'}}));let browser;
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  for(const [index,lang] of ['ja','en'].entries()){
   const token=(index?'b':'a').repeat(64),name='Guest <b>'+lang+'</b>',response=await mf.dispatchFetch('https://wordnest.example/api/ranking/profile',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({revision:0,name,enabled:false,timezone:'UTC',epoch:''})}),{profile}=await response.json();assert.ok(profile?.id);
   browser=await harness(mf,lang);const {w,find,click,input,until}=browser;
   await click('[data-action="settings"]');input('#admin-password','administrator-password');find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>find('[data-nav="admin"]'));await click('[data-dialog="cancel"]');await click('[data-nav="admin"]');await until(()=>find('[data-action="admin-erase"]'));
   input('#admin-search',name);await until(()=>find('.admin-participant h2')?.textContent===name);assert.equal(find('.admin-participant b'),null);assert.equal(find('[data-action="admin-account"]'),null);assert.ok(find('.account-type').textContent.includes(messages[lang].adminGuest));
   await click('[data-action="admin-erase"]');assert.equal(find('#modal-title').textContent,messages[lang].adminEraseLearner);assert.ok(find('#modal').textContent.includes(messages[lang].adminEraseLearnerHelp));assert.ok(find('#modal').textContent.includes(profile.id.slice(0,12)));assert.equal(find('[autofocus]'),null);await click('[data-learner-close]');assert.ok(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(profile.id).first());
   await click('[data-action="admin-erase"]');input('#erase-learner-confirm','wrong');const submit=()=>find('#erase-learner-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));submit();assert.equal(find('#erase-learner-error').textContent,messages[lang].learnerConfirmIdentity);assert.ok(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(profile.id).first());
   input('#erase-learner-confirm',profile.id.slice(0,12));submit();await until(()=>!find('#modal').open);assert.ok(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(profile.id).first(),'records remain during the hold');await completeDeletionHold(mf,profile.id);await click('[data-action="admin-refresh"]');await until(()=>find('.administration-view .empty'));assert.equal(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(profile.id).first(),null);assert.equal((await mf.dispatchFetch('https://wordnest.example/api/ranking/profile',{headers:{Authorization:'Bearer '+token}})).status,410);
   browser.close();browser=null;
  }
 }finally{browser?.close();await mf.dispose();}
});
