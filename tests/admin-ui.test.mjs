import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
import { seed } from './fixture.js';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const password='administrator-password';
async function harness({hash='#/guide',authenticated=false,configured=true}={}) {
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/'+hash,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});
  w.document.hasFocus=()=>true;w.Audio=class{play(){return Promise.resolve();}};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  let expireWrites=false,delayLogin;
  const set={...structuredClone(seed),id:'seed',revision:1};
  w.fetch=async(path,options={})=>{
    let status=200,data;
    if(path==='/api/session')data={authenticated,configured};
    else if(path==='/api/sets' && !options.method)data={sets:[set],orderRevision:0};
    else if(path==='/api/login'){
      if(delayLogin)await delayLogin;
      if(JSON.parse(options.body).password===password){authenticated=true;data={ok:true};}
      else{status=401;data={error:'wrongPassword'};}
    }else if(path==='/api/logout'){authenticated=false;data={ok:true};}
    else if(path.startsWith('/api/sets/') && expireWrites){authenticated=false;status=401;data={error:'unauthorized'};}
    else throw new Error(path);
    return {ok:status===200,status,json:async()=>data};
  };
  const find=s=>w.document.querySelector(s);
  async function click(s){const element=find(s);assert.ok(element,s);element.click();await tick();await tick();}
  function input(s,value){find(s).value=value;find(s).dispatchEvent(new w.Event('input',{bubbles:true}));}
  async function login(value=password){input('#admin-password',value);find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();}
  w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();
  return {w,find,click,input,login,expire(){expireWrites=true;},delay(promise){delayLogin=promise;}};
}
test('administrator access lives at Settings bottom and controls Edit and its guide in both languages',async()=>{
  const {w,find,click,login}=await harness();
  try{
    assert.equal(find('.nav [data-nav="edit"]'),null);assert.equal(find('#guide-edit'),null);
    assert.equal(find('[aria-labelledby="guide-settings"]').textContent.includes('Import'),false);
    await click('[data-action="settings"]');
    assert.equal([...w.document.querySelectorAll('#modal .settings-section')].at(-1).id,'admin-controls');
    assert.equal(find('#modal [data-action="import"]'),null);assert.ok(find('#admin-password'));
    await login('incorrect-password');assert.equal(find('[role="alert"]').textContent,messages.en.wrongPassword);assert.equal(find('.nav [data-nav="edit"]'),null);assert.equal(find('#admin-password').value,'');
    await login();assert.ok(find('.nav [data-nav="edit"]'));assert.equal(find('#admin-password'),null);assert.ok(find('#guide-edit'));
    const sections=[...w.document.querySelectorAll('.guide-section')];assert.equal(sections.at(-1).getAttribute('aria-labelledby'),'guide-admin');assert.equal(sections.at(-2).getAttribute('aria-labelledby'),'guide-edit');
    assert.ok(sections.at(-2).textContent.includes('Import'));assert.equal(sections.at(-3).textContent.includes('Import'),false);
    find('#settings-language').value='ja';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(find('#admin-settings-title').textContent,'管理者モード');assert.equal(find('[data-admin-open]').textContent.trim(),'編集画面を開く');assert.ok(find('#guide-edit+ul').textContent.includes('管理者パスワード'));
    await click('[data-admin-open]');assert.equal(w.location.hash,'#/edit');assert.ok(find('.editor-toolbar'));assert.equal(find('[data-action="logout"]'),null);assert.equal(find('input[type="password"]'),null);assert.equal(find('#login-form'),null);
    await click('.nav [data-nav="guide"]');await click('[data-action="settings"]');await click('[data-admin-lock]');
    assert.equal(find('.nav [data-nav="edit"]'),null);assert.equal(find('#guide-edit'),null);assert.equal(find('#modal').open,false);
    await click('[data-action="settings"]');assert.equal(find('label[for="admin-password"]').firstChild.textContent,'管理者パスワード');
    assert.equal([...Array(w.localStorage.length)].some((_,i)=>String(w.localStorage.getItem(w.localStorage.key(i))).includes(password)),false);
  }finally{w.close();}
});
test('direct editor links honor the server cookie and anonymous links return to Practice',async()=>{
  for(const authenticated of [false,true]){
    const {w,find}=await harness({hash:'#/edit',authenticated});
    try{assert.equal(w.location.hash,authenticated?'#/edit':'#/');assert.equal(!!find('.editor-toolbar'),authenticated);assert.equal(find('input[type="password"]'),null);assert.equal(!!find('.nav [data-nav="edit"]'),authenticated);}
    finally{w.close();}
  }
});
test('session expiry hides administrator UI and Settings reauthentication resumes the draft',async()=>{
  const {w,find,click,input,login,expire}=await harness({hash:'#/edit',authenticated:true});
  try{
    await click('[data-action="edit-set"]');input('#set-title','Unsaved draft');expire();await click('[data-action="save"]');
    assert.equal(w.location.hash,'#/');assert.equal(find('.nav [data-nav="edit"]'),null);
    await click('[data-action="settings"]');await login();await click('[data-admin-open]');
    assert.equal(find('#set-title').value,'Unsaved draft');assert.equal(find('#dirty-label').textContent,messages.en.unsaved);
    await click('[data-action="settings"]');await click('[data-admin-lock]');assert.ok(find('[data-dialog="confirm"]'));await click('[data-dialog="cancel"]');assert.ok(find('.nav [data-nav="edit"]'));assert.equal(find('#set-title').value,'Unsaved draft');
  }finally{w.close();}
});
test('closing Settings during authentication does not reopen it, and unavailable admin access has no form',async()=>{
  const {w,find,click,input,delay}=await harness();
  try{
    await click('[data-action="settings"]');let release;delay(new Promise(resolve=>{release=resolve;}));input('#admin-password',password);find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.ok(find('#admin-login-form button').disabled);await click('[data-dialog="cancel"]');release();await tick();await tick();assert.equal(find('#modal').open,false);assert.ok(find('.nav [data-nav="edit"]'));
  }finally{w.close();}
  const unavailable=await harness({configured:false});
  try{await unavailable.click('[data-action="settings"]');assert.equal(unavailable.find('#admin-login-form'),null);assert.ok(unavailable.find('#admin-controls').textContent.includes(messages.en.adminUnavailable));}
  finally{unavailable.w.close();}
});
