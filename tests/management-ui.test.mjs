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
 const cookies=new Map();w.fetch=async(path,options={})=>{const response=await mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{})}});if(response.headers.has('set-cookie')){const pair=response.headers.get('set-cookie').split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}return response;};
 w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined',name,id,token}));
 const tracker=new statistics.LearningTracker({storage:w.localStorage});tracker.answer(true);tracker.persist();
 const find=s=>w.document.querySelector(s),click=async s=>{assert.ok(find(s),s);find(s).click();await tick();await tick();};
 async function login(password){await click('[data-action="settings"]');find('#admin-password').value=password;find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!find('#admin-login-form') || !!find('#admin-controls .error'));}
 w.eval(source);await until(()=>!!find('.guide-view') && !find('.loading'));await tick();return {w,id,find,click,login,close:()=>w.close()};
}
test('management UI supports approvals, private notification receipts, account device sessions, deletion holds, recovery, and audit in both languages',async()=>{
 for(const lang of ['en','ja']){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:ordinary,SUPER_ADMIN_PASSWORD:highest}}));let owner,user;
  try{
   owner=await browser(mf,lang,'a'.repeat(64),'Owner');user=await browser(mf,lang,'b'.repeat(64),'Learner');
   await owner.login(highest);await owner.click('[data-dialog="cancel"]');await owner.click('.nav [data-nav="admin"]');
   await user.login(ordinary);assert.equal(user.find('#admin-controls .error').textContent,messages[lang].adminApprovalPending);assert.equal(user.find('.nav [data-nav="admin"]'),null);await user.click('[data-dialog="cancel"]');
   await owner.click('[data-action="admin-refresh"]');const approve='[data-action="admin-approve"][data-id="'+user.id+'"]';await until(()=>owner.find(approve));await owner.click(approve);await owner.click('[data-dialog="confirm"]');await until(()=>!owner.find('#modal').open && !owner.find(approve));
   await user.login(ordinary);await user.click('[data-dialog="cancel"]');
   const notify='[data-action="admin-notify"][data-id="'+user.id+'"]';await until(()=>owner.find(notify));await owner.click(notify);await until(()=>owner.find('#notification-form'));
   const form=owner.find('#notification-form');form.elements.messageJa.value='<b>日本語のお知らせ</b>';form.elements.messageEn.value='<b>English notice</b>';form.dispatchEvent(new owner.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>owner.find('#notification-result').textContent===messages[lang].notificationSent);assert.equal(form.elements.messageEn.value,'<b>English notice</b>','sent text is retained');await owner.click('[data-dialog="cancel"]');
   user.w.dispatchEvent(new user.w.Event('online'));await until(()=>user.find('.management-message'));assert.equal(user.find('.management-message b'),null);assert.equal(user.find('.management-message').textContent,lang==='ja'?'<b>日本語のお知らせ</b>':'<b>English notice</b>');await user.click('[data-learner-note-ack]');await until(()=>!user.find('#modal').open);
   await owner.click(notify);await until(()=>owner.find('#modal').open && owner.find('#notification-receipts')?.textContent.includes(messages[lang].notificationRead));await owner.click('[data-dialog="cancel"]');
   await user.click('[data-action="account"]');await user.click('[data-account-mode="register"]');const loginId='managed_'+lang,password='a sufficiently long learner password';user.find('#account-login-id').value=loginId;user.find('#account-password').value=password;user.find('#account-confirm').value=password;user.find('#account-display-name').value='Learner';user.find('#account-form').dispatchEvent(new user.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>user.find('[data-account-command="sessions"]'));
   const other=await mf.dispatchFetch(origin+'/api/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginId,password})});assert.equal(other.status,200);
   await user.click('[data-account-command="sessions"]');await until(()=>user.find('[data-revoke-session]'));assert.ok(user.find('#modal').textContent.includes(messages[lang].sessionCurrent));await user.click('[data-revoke-session]');await user.click('[data-dialog="confirm"]');await until(()=>user.find('[data-revoke-sessions]') && !user.find('[data-revoke-session]'));await user.click('[data-dialog="cancel"]');await until(()=>user.find('[data-account-close]'));await user.click('[data-account-close]');
   await owner.click('[data-action="admin-refresh"]');const erase='[data-action="admin-erase"][data-id="'+user.id+'"]';await until(()=>owner.find(erase));await owner.click(erase);owner.find('#erase-learner-confirm').value=loginId;owner.find('#erase-learner-form').dispatchEvent(new owner.w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!owner.find('#modal').open && owner.find('.administration-view').textContent.includes(messages[lang].deletionPending));
   await user.click('.nav [data-nav="home"]');user.w.dispatchEvent(new user.w.Event('online'));await until(()=>user.find('.suspension-view'));assert.ok(user.find('.suspension-view').textContent.includes(messages[lang].suspensionLocal));const db=await mf.getD1Database('DB');assert.ok(await db.prepare('SELECT id FROM accounts WHERE login_id=?').bind(loginId).first());assert.equal(await db.prepare('SELECT profile_id FROM learner_deletions WHERE profile_id=?').bind(user.id).first(),null);
   await owner.click('[data-action="admin-deletions"]');await until(()=>owner.find('[data-cancel-deletion]'));await owner.click('[data-cancel-deletion]');await owner.click('[data-dialog="confirm"]');await until(()=>owner.find('.management-list') && !owner.find('[data-cancel-deletion]'));await owner.click('[data-dialog="cancel"]');
   user.w.dispatchEvent(new user.w.Event('online'));await until(()=>!user.find('.suspension-view'));await user.click('.nav [data-nav="stats"]');assert.equal(user.find('[data-stat="answeredQuestions"]').textContent,'1');
   await owner.click('[data-action="admin-audit"]');await until(()=>owner.find('#audit-list'));assert.ok(owner.find('#audit-list').textContent.includes(messages[lang].audit_administrator_approve));assert.ok(owner.find('#audit-list').textContent.includes(messages[lang].audit_notification_send));assert.ok(!owner.find('#audit-list').textContent.includes(password));await owner.click('[data-dialog="cancel"]');
  }finally{owner?.close();user?.close();await mf.dispose();}
 }
});
