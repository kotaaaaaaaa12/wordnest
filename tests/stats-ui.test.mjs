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
test('records count answers and flips once, persist early exits, pause background/dialog time, and translate',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/stats',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;let now=new Date(2026,9,19,12).getTime(),visible=true,focused=true;const timers=new Map(),timeouts=new Map();let timerId=0;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});
  w.Date.now=()=>now;w.setInterval=fn=>{const id=++timerId;timers.set(id,fn);return id;};w.clearInterval=id=>timers.delete(id);w.setTimeout=(fn,delay)=>{const id=++timerId;timeouts.set(id,{fn,at:now+delay});return id;};w.clearTimeout=id=>timeouts.delete(id);
  Object.defineProperty(w.document,'visibilityState',{get:()=>visible?'visible':'hidden'});
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[{...seed,id:'seed',revision:1}],orderRevision:0}:{authenticated:false,configured:true}});
  w.document.hasFocus=()=>focused;
  const find=s=>w.document.querySelector(s);
  async function click(selector){assert.ok(find(selector),selector);find(selector).click();await tick();await tick();}
  const advance=ms=>{now+=ms;for(const fn of [...timers.values()])fn();for(const [id,entry] of [...timeouts])if(entry.at<=now){timeouts.delete(id);entry.fn();}};
  const summary=()=>new statistics.LearningTracker({storage:w.localStorage,now:()=>now,id:'observer'}).snapshot();
  try{
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();assert.ok(find('.stats-view'));assert.equal(find('[data-stat="answeredQuestions"]').textContent,'0');assert.equal(w.document.querySelectorAll('.stats-bars li').length,7);
    advance(10000);await click('.nav [data-nav="home"]');await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="en-ja"]');await click('[data-action="start"]');
    advance(3000);const word=seed.words.find(word=>word.english===find('.question-word').textContent),button=[...w.document.querySelectorAll('.option')].find(button=>button.textContent.slice(1)===word.meaning);button.click();button.click();await tick();assert.equal(summary().answered,1);assert.equal(summary().correct,1);
    advance(2000);await click('[data-action="settings"]');assert.equal(find('[data-settings-action]'),null);advance(10000);await click('[data-dialog="cancel"]');assert.equal(summary().totalMs,5000);
    advance(1000);await click('[data-action="next"]');advance(15000);assert.ok(find('.feedback.wrong'));assert.equal(summary().answered,2);assert.equal(summary().correct,1);
    await click('[data-action="next"]');await click('[data-action="skip"]');assert.equal(summary().answered,3);
    await click('[data-action="quit"]');await click('[data-dialog="confirm"]');await click('.nav [data-nav="stats"]');assert.equal(find('[data-stat="answeredQuestions"]').textContent,'3');assert.equal(find('[data-stat="correctQuestions"]').textContent,'1');assert.equal(find('[data-stat="currentStreak"]').textContent,'1 day');
    await click('.nav [data-nav="home"]');await click('[data-action="open"]');await click('[data-activity="cards"]');await click('[data-mode="en-ja"]');await click('[data-action="start-cards"]');
    advance(4000);await click('[data-action="flip-card"]');await click('[data-action="flip-card"]');assert.equal(summary().flips,2);await click('[data-action="next-card"]');assert.equal(summary().flips,2);
    const beforeBlur=summary().totalMs;focused=false;w.dispatchEvent(new w.Event('blur'));advance(10000);focused=true;w.dispatchEvent(new w.Event('focus'));assert.equal(summary().totalMs,beforeBlur);
    const beforeHidden=summary().totalMs;visible=false;w.document.dispatchEvent(new w.Event('visibilitychange'));advance(30000);visible=true;w.document.dispatchEvent(new w.Event('visibilitychange'));assert.equal(summary().totalMs,beforeHidden);
    advance(90000);assert.equal(summary().totalMs,beforeHidden+60000);w.document.dispatchEvent(new w.Event('scroll'));advance(2000);
    await click('.nav [data-nav="stats"]');assert.equal(summary().totalMs,beforeHidden+62000);assert.equal(find('[data-stat="cardFlips"]').textContent,'2');
    await click('[data-action="settings"]');find('#settings-language').value='ja';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));await click('[data-dialog="cancel"]');assert.equal(find('.stats-view h1').textContent,'学習記録');assert.equal(find('[data-stat="currentStreak"]').textContent,'1日');assert.ok(find('.stats-view').textContent.includes('1日平均学習時間'));
    const keys=Array.from({length:w.localStorage.length},(_,index)=>w.localStorage.key(index)).filter(key=>key.startsWith('wordnest-learning-v1:'));assert.equal(keys.length,1);assert.equal(summary().answered,3);assert.equal(summary().flips,2);
    w.dispatchEvent(new w.Event('pagehide'));advance(20000);w.dispatchEvent(new w.Event('pageshow'));assert.equal(summary().totalMs,beforeHidden+62000);
  }finally{w.close();}
});
