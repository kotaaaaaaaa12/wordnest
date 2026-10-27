import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import {icon} from '../public/icons.js';
import {messages,translator} from '../public/i18n.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,''),bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const origin='https://wordnest.example',ordinary='ordinary-admin-password',highest='super-administrator-password';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let i=0;i<600;i++){if(check())return;await tick();}assert.fail(String(check));}
async function browser(mf,lang,token,name){
 const id=createHash('sha256').update(token).digest('hex'),db=await mf.getD1Database('DB');await mf.dispatchFetch(origin+'/api/sets');await db.prepare('INSERT OR IGNORE INTO ranking_profiles(id,name,enabled,epoch,timezone,updated_at) VALUES (?,?,0,?,?,?)').bind(id,name,'fixture','UTC',new Date().toISOString()).run();
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:origin+'/#/guide',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
 const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
 w.Audio=class{play(){return Promise.resolve();}};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 let cookie='';w.fetch=async(path,options={})=>{const response=await mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
 w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined',name,id,token}));
 const tracker=new statistics.LearningTracker({storage:w.localStorage});tracker.answer(true);tracker.persist();
 const find=s=>w.document.querySelector(s),click=async s=>{assert.ok(find(s),s);find(s).click();await tick();await tick();};
 async function login(password){await click('[data-action="settings"]');find('#admin-password').value=password;find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!find('#admin-login-form') || !!find('#admin-controls .error'));}
 w.eval(source);await until(()=>!!find('.guide-view') && !find('.loading'));await tick();return {w,id,find,click,login,close:()=>w.close()};
}
test('both languages support guest badges, confirmed revocation and restoration, live session loss, and elevation',async()=>{
 for(const lang of ['en','ja']){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:ordinary,SUPER_ADMIN_PASSWORD:highest}}));let owner,admin;
  try{
   owner=await browser(mf,lang,'a'.repeat(64),'Owner');admin=await browser(mf,lang,'b'.repeat(64),'Guest administrator');
   await owner.login(highest);assert.ok(owner.find('#admin-controls').textContent.includes(messages[lang].adminRoleSuper));await owner.click('[data-dialog="cancel"]');
   await admin.login(ordinary);assert.equal(admin.find('#admin-controls .error').textContent,messages[lang].adminApprovalPending);await admin.click('[data-dialog="cancel"]');
   await owner.click('.nav [data-nav="admin"]');await until(()=>owner.find('[data-action="admin-approve"][data-id="'+admin.id+'"]'));await owner.click('[data-action="admin-approve"][data-id="'+admin.id+'"]');await owner.click('[data-dialog="confirm"]');await until(()=>!owner.find('#modal').open);
   await admin.login(ordinary);await admin.click('[data-dialog="cancel"]');await admin.click('.nav [data-nav="admin"]');await until(()=>admin.find('.administrator-badge'));assert.equal(admin.find('.administrator-access'),null);assert.ok(admin.find('.administration-view').textContent.includes(messages[lang].adminRoleSuper));
   await owner.click('.nav [data-nav="admin"]');await until(()=>owner.find('[data-action="admin-permission"][data-id="'+admin.id+'"]'));
   const target='[data-action="admin-permission"][data-id="'+admin.id+'"]';
   await owner.click(target);await owner.click('[data-dialog="cancel"]');assert.equal(owner.find(target).textContent,messages[lang].adminRevoke);
   await admin.click('[data-action="settings"]');await owner.click(target);await owner.click('[data-dialog="confirm"]');await until(()=>owner.find(target)?.textContent===messages[lang].adminRestore);
   admin.w.dispatchEvent(new admin.w.Event('online'));await until(()=>!admin.find('.nav [data-nav="admin"]'));assert.equal(admin.find('#modal').open,false);
   await admin.login(ordinary);assert.equal(admin.find('#admin-controls .error').textContent,messages[lang].adminAccessRevoked);await admin.click('[data-dialog="cancel"]');
   await owner.click(target);await owner.click('[data-dialog="confirm"]');await until(()=>owner.find(target)?.textContent===messages[lang].adminRevoke);
   await admin.login(ordinary);await admin.click('[data-admin-elevate]');await until(()=>admin.find('#elevate-admin-form'));const form=admin.find('#elevate-admin-form');form.querySelector('input').value='incorrect-highest-password';form.dispatchEvent(new admin.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>admin.find('#elevate-error')?.hidden===false);assert.ok(admin.find('.nav [data-nav="admin"]'),'a failed elevation retains ordinary administrator access');form.querySelector('input').value=highest;form.dispatchEvent(new admin.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>admin.find('#admin-controls')?.textContent.includes(messages[lang].adminRoleSuper));
   await admin.click('[data-dialog="cancel"]');await admin.click('.nav [data-nav="stats"]');assert.equal(admin.find('[data-stat="answeredQuestions"]').textContent,'1');
  }finally{owner?.close();admin?.close();await mf.dispose();}
 }
});
