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
test('localized account forms transfer guest records, keep recovery private, log in across browsers, separate ranking display names, and keep admin access separate',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'administrator-password'}}));let a,b;
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  a=await harness(mf,'ja');new statistics.LearningTracker({storage:a.w.localStorage,id:'guest-test'}).answer(true);
  await a.click('[data-action="account"]');assert.equal(a.find('#modal-title').textContent,'ログイン');assert.equal(a.find('#account-password').getAttribute('autocomplete'),'current-password');
  await a.click('[data-account-mode="register"]');a.input('#account-login-id','private_login');a.input('#account-password','a secure long passphrase');a.input('#account-confirm','different passphrase');a.input('#account-display-name','表示用の名前');a.submit();await a.until(()=>!a.find('#account-error').hidden);assert.equal(a.find('#account-error').textContent,messages.ja.accountPasswordMismatch);
  a.input('#account-confirm','a secure long passphrase');a.find('#account-listed').checked=true;a.submit();await a.until(()=>a.find('.account-recovery-code'));const recovery=a.find('.account-recovery-code').value;assert.match(recovery,/^[a-f0-9]{8}(-[a-f0-9]{8}){7}$/);assert.equal(a.find('[data-nav="edit"]'),null);assert.ok(!JSON.stringify(Object.values(a.w.localStorage)).includes(recovery));
  await a.click('[data-dialog="confirm"]');await a.until(()=>a.find('[data-account-command="logout"]'));await a.click('[data-account-close]');await a.click('[data-nav="stats"]');assert.ok(a.find('.stats-note').textContent.includes('すべての端末'));assert.equal(a.find('[data-nav="admin"]'),null);
  b=await harness(mf);await b.click('[data-action="account"]');b.input('#account-login-id','PRIVATE_LOGIN');b.input('#account-password','a secure long passphrase');b.submit();await b.until(()=>b.find('[data-account-command="logout"]'));assert.equal(b.find('.account-id strong').textContent,'private_login');await b.click('[data-account-close]');await b.click('[data-nav="stats"]');assert.equal(b.find('.stats-note').textContent,messages.en.accountStatsHelp);
  await b.click('[data-nav="rankings"]');await b.until(()=>b.find('.rankings-view')?.textContent.includes('表示用の名前'));assert.ok(!b.find('.rankings-view').textContent.includes('private_login'));
  await b.click('[data-action="settings"]');assert.ok(b.find('#account-settings').textContent.includes('private_login'));assert.ok(b.find('.settings-data-note').textContent.includes('every synced device'));await b.click('[data-dialog="cancel"]');
  await b.click('[data-action="account"]');await b.click('[data-account-mode="password"]');b.input('#account-current-password','a secure long passphrase');b.input('#account-password','a changed long passphrase');b.input('#account-confirm','a changed long passphrase');b.submit();await b.until(()=>b.find('.account-recovery-code'));assert.notEqual(b.find('.account-recovery-code').value,recovery);await b.click('[data-dialog="confirm"]');await b.until(()=>b.find('[data-account-command="logout"]'));await b.click('[data-account-command="logout"]');await b.until(()=>!b.find('#modal').open);await b.click('[data-action="account"]');assert.equal(b.find('#modal-title').textContent,messages.en.accountLogin);
 }finally{a?.close();b?.close();await mf.dispose();}
});
