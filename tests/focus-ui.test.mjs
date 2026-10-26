import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
import { seed } from './fixture.js';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function harness(){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const sets=['first','second'].map(id=>({...structuredClone(seed),id,title:id,revision:1}));
  let finish;
  w.fetch=async(path)=>{
    if(path.startsWith('/api/rankings'))return new Promise(resolve=>{finish=()=>resolve({ok:true,status:200,json:async()=>({metric:new URL(path,'https://wordnest.example').searchParams.get('metric'),rows:[],mine:null,total:0})});});
    return {ok:true,status:200,json:async()=>path==='/api/sets'?{sets,orderRevision:0}:{authenticated:false,configured:true}};
  };
  w.localStorage.setItem(rankingTools.RANKING_KEY,JSON.stringify({choice:'declined'}));
  const personal=new personalTools.PersonalWords(w.localStorage);
  for(const question of personalTools.sourceQuestions(sets,'en-ja')){personal.answer(question.sources,false);personal.answer(question.sources,false);}
  w.eval(source);await tick();await tick();
  const find=s=>w.document.querySelector(s);
  async function click(s){assert.ok(find(s),s);find(s).click();await tick();await tick();}
  function commit(s,value){const el=find(s);el.focus();el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));assert.notEqual(w.document.activeElement.tagName,'SELECT');}
  return {w,find,click,commit,finish:()=>finish?.()};
}
test('practice pickers release focus, Escape releases selection focus, and search caret survives rerendering',async()=>{
  const {w,find,click,commit}=await harness();
  try{
    const search=find('#search');search.focus();search.value='first';search.setSelectionRange(1,3);search.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(w.document.activeElement.id,'search');assert.equal(find('#search').selectionStart,1);assert.equal(find('#search').selectionEnd,3);
    await click('[data-action="library-tab"][data-tab="weak"]');commit('#weak-set','second');assert.equal(find('#weak-set').value,'second');
    await click('[data-action="library-tab"][data-tab="favorites"]');commit('#favorite-set','first');assert.equal(find('#favorite-set').value,'first');
    find('#favorite-set').focus();find('#favorite-set').dispatchEvent(new w.KeyboardEvent('keyup',{key:'Enter',bubbles:true}));assert.equal(w.document.activeElement,find('#favorite-set'),'Enter can open a picker normally');find('#favorite-set').dispatchEvent(new w.KeyboardEvent('keyup',{key:'Escape',bubbles:true}));assert.notEqual(w.document.activeElement.tagName,'SELECT');
    await click('[data-action="settings"]');commit('#theme-choice','dark');commit('#dark-palette','graphite');commit('#settings-language','ja');assert.equal(w.document.documentElement.dataset.palette,'graphite');assert.equal(w.document.documentElement.lang,'ja');
    find('#theme-choice').focus();assert.equal(w.document.activeElement,find('#theme-choice'),'a deliberate new interaction can reopen the select');commit('#theme-choice','light');assert.equal(w.document.documentElement.dataset.theme,'light');
  }finally{w.close();}
});
test('asynchronous ranking renders never refocus selects, while password input keeps its current caret',async()=>{
  const {w,find,click,finish}=await harness();
  try{
    await click('.nav [data-nav="rankings"]');assert.ok(find('.ranking-loading'));
    const picker=find('#ranking-metric');picker.focus();let selectFocus=0;const focus=w.HTMLSelectElement.prototype.focus;w.HTMLSelectElement.prototype.focus=function(...args){selectFocus++;return focus.apply(this,args);};await click('[data-action="ranking-category"]');assert.equal(find('#ranking-metric').getAttribute('aria-expanded'),'true');assert.equal(find('[data-ranking-category][aria-pressed="true"]').dataset.rankingCategory,'totalMs');
    finish();await tick();await tick();assert.equal(selectFocus,0);assert.notEqual(w.document.activeElement.tagName,'SELECT');assert.ok(find('#modal').open,'background ranking completion keeps the category dialog open');assert.equal(find('#ranking-metric').getAttribute('aria-expanded'),'true');find('#modal').dispatchEvent(new w.Event('cancel',{cancelable:true}));await tick();assert.equal(find('#modal').open,false);assert.equal(find('#ranking-metric').getAttribute('aria-expanded'),'false');
    // Closing a modal must not restore focus to its previously focused picker.
    find('#ranking-metric').focus();const count=selectFocus;await click('[data-action="settings"]');await click('[data-dialog="cancel"]');assert.equal(selectFocus,count);assert.notEqual(w.document.activeElement.tagName,'SELECT');
    await click('[data-action="ranking-refresh"]');assert.ok(find('.ranking-loading'));await click('[data-action="settings"]');
    const input=find('#admin-password');input.focus();input.value='still typing';input.setSelectionRange(1,5);let calls=0;const inputFocus=input.focus.bind(input);input.focus=(...args)=>{calls++;return inputFocus(...args);};
    finish();await tick();await tick();assert.equal(calls,0);assert.equal(w.document.activeElement,input);assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,5);assert.equal(selectFocus,count);
  }finally{w.close();}
});

test('category selection cancels safely, ignores repeated taps, and keeps the newest ranking when responses arrive out of order',async()=>{
  const {w,find,click,finish}=await harness();
  try{
    await click('.nav [data-nav="rankings"]');finish();await tick();await tick();
    const requests=[],pending=new Map(),original=w.fetch;
    w.fetch=(path,...args)=>{
      if(!path.startsWith('/api/rankings?'))return original(path,...args);
      const metric=new URL(path,'https://wordnest.example').searchParams.get('metric');requests.push(metric);
      return new Promise(resolve=>pending.set(metric,()=>resolve({ok:true,status:200,json:async()=>({metric,rows:[{id:metric,name:metric,rank:1,value:60}],mine:null,total:1})})));
    };
    await click('[data-action="ranking-category"]');await click('[data-dialog="cancel"]');assert.equal(requests.length,0);assert.equal(find('#modal').open,false);
    await click('[data-action="ranking-category"]');await click('[data-ranking-category="totalMs"]');assert.equal(requests.length,0,'same category does not refetch');
    await click('[data-action="ranking-category"]');const stale=find('[data-ranking-category="answered"]');stale.click();stale.click();await tick();await tick();assert.deepEqual(requests,['answered']);assert.equal(find('#modal').open,false);
    await click('[data-action="ranking-category"]');await click('[data-ranking-category="correct"]');assert.deepEqual(requests,['answered','correct']);
    pending.get('correct')();await tick();await tick();assert.equal(find('.ranking-name').textContent,'correct');
    pending.get('answered')();await tick();await tick();assert.equal(find('.ranking-name').textContent,'correct');assert.ok(find('#ranking-metric').textContent.includes(messages.en.correctQuestions));assert.equal(find('#modal').open,false);
    await click('[data-action="settings"]');find('#settings-language').value='ja';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));await click('[data-dialog="cancel"]');await click('[data-action="ranking-category"]');assert.equal(find('#modal-title').textContent,messages.ja.rankingMetric);assert.equal(find('[data-ranking-category="correct"]').getAttribute('aria-pressed'),'true');assert.ok(find('[data-ranking-category="correct"]').textContent.includes(messages.ja.correctQuestions));
  }finally{w.close();}
});
