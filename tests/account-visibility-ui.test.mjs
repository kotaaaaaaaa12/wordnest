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
test('account access remains available during quizzes and flashcards, and closing it returns to the same practice',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB']}));let browser;
 try{
  await mf.dispatchFetch('https://wordnest.example/api/sets');const db=await mf.getD1Database('DB');await db.prepare('INSERT INTO sets (id,title,words,updated_at) VALUES (?,?,?,?)').bind('seed',seed.title,JSON.stringify(seed.words),new Date().toISOString()).run();
  for(const activity of ['quiz','cards']){
   browser=await harness(mf);const {find,click,until}=browser;
   await click('[data-action="open"]');await click(`[data-activity="${activity}"]`);await click('[data-mode="en-ja"]');await click(`[data-action="${activity==='quiz'?'start':'start-cards'}"]`);
   assert.ok(find('.app-shell.is-practicing'));const practice=find(activity==='quiz'?'.question-card':'.flashcard').textContent;
   await click('.sidebar [data-action="account"]');await until(()=>find('#account-form'));assert.equal(find('#modal-title').textContent,messages.en.accountLogin);await click('[data-account-close]');
   assert.ok(find('.app-shell.is-practicing'));assert.equal(find(activity==='quiz'?'.question-card':'.flashcard').textContent,practice);
   await click('[data-action="settings"]');const {version}=JSON.parse(await readFile('package.json','utf8'));assert.equal(find('#modal').lastElementChild.className,'app-version');assert.equal(find('.app-version').textContent,'wordnest v'+version);
   assert.equal(find('#modal').querySelectorAll('[data-dialog="cancel"]').length,1,'Settings has only its header close button');assert.ok(find('.settings-modal-header .modal-close'));assert.equal(find('#modal > .modal-actions'),null);find('#modal').scrollTop=800;
   const language=find('#settings-language');language.value='ja';language.dispatchEvent(new browser.w.Event('change',{bubbles:true}));assert.equal(find('#modal').lastElementChild.textContent,'wordnest v'+version);assert.ok(find('.settings-modal-header .modal-close'));await click('.settings-modal-header .modal-close');assert.equal(find('#modal').open,false);
   browser.close();browser=null;
  }
 }finally{browser?.close();await mf.dispose();}
});
