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
async function harness({saved={},lang='en',hash='#/',set={...seed,id:'seed',revision:1},now=new Date(2026,9,21,12).getTime()}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/'+hash,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.Date.now=()=>now;w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>['learningHeartbeat','retry'].includes(callback?.name)?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[set],orderRevision:0}:{authenticated:false,configured:true}});
  w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.localStorage.setItem('wordnest-language',lang);for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,value);
  const find=selector=>w.document.querySelector(selector);
  async function click(selector){const el=find(selector);assert.ok(el,selector);assert.equal(el.disabled || false,false,selector+' enabled');el.click();await tick();await tick();}
  const snapshot=()=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,index)=>{const key=w.localStorage.key(index);return [key,w.localStorage.getItem(key)];}));
  w.eval(source);await tick();await tick();return {w,find,click,snapshot,set,close:()=>w.close()};
}
async function cards(h,mode='en-ja',order='original'){await h.click('[data-action="open"]');await h.click('[data-activity="cards"]');await h.click('[data-mode="'+mode+'"]');await h.click('[data-order="'+order+'"]');await h.click('[data-action="start-cards"]');}
const flipCount=h=>new statistics.LearningTracker({storage:h.w.localStorage,id:'observer'}).snapshot().flips;
test('flashcards resume after reopening with the same random sequence, direction, index and side without adding flips',async()=>{
  let h=await harness();
  try{
    await cards(h,'ja-en','random');const sequence=[];for(let i=0;i<seed.words.length;i++){sequence.push(h.find('.flashcard-back .flashcard-text').textContent);if(i<seed.words.length-1)await h.click('[data-action="next-card"]');}
    for(let i=0;i<seed.words.length-4;i++)await h.click('[data-action="previous-card"]');await h.click('[data-action="flip-card"]');const count=flipCount(h),saved=h.snapshot();h.close();h=await harness({saved});
    await h.click('[data-action="open"]');await h.click('[data-activity="cards"]');assert.ok(h.find('.cards-resume').textContent.includes('JP → EN'));assert.ok(h.find('.cards-resume').textContent.includes('Random'));
    await h.click('[data-action="resume-cards"]');assert.equal(h.find('.flashcard-back .flashcard-text').textContent,sequence[3]);assert.equal(h.find('[data-action="flip-card"]').getAttribute('aria-pressed'),'true');assert.equal(flipCount(h),count);
    await h.click('[data-action="next-card"]');assert.equal(h.find('.flashcard-back .flashcard-text').textContent,sequence[4]);assert.equal(h.find('[data-action="flip-card"]').getAttribute('aria-pressed'),'false');
    await h.click('[data-action="back-order"]');await h.click('[data-order="original"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-back .flashcard-text').textContent,seed.words[0].english);assert.equal(h.find('#card-counter').textContent,'Card 1 of 20');
  }finally{h.close();}
});
test('favorites and difficult-word decks have separate resumable positions and changed sets hide stale bookmarks',async()=>{
  let h=await harness();
  try{
    const personal=new personalTools.PersonalWords(h.w.localStorage);for(const word of h.set.words.slice(0,4))personal.toggleFavorite(personalTools.wordIdentity(h.set.id,word));
    const question=personalTools.sourceQuestions([h.set],'en-ja')[0];personal.answer(question.sources,false);personal.answer(question.sources,false);
    await h.click('[data-action="library-tab"][data-tab="favorites"]');await h.click('[data-action="start-collection"][data-activity="cards"]');await h.click('[data-mode="en-ja"]');await h.click('[data-action="start-cards"]');await h.click('[data-action="next-card"]');
    await h.click('[data-action="back-home"]');await h.click('[data-action="library-tab"][data-tab="weak"]');await h.click('[data-action="start-collection"][data-activity="cards"]');assert.equal(h.find('[data-action="resume-cards"]'),null);await h.click('[data-action="start-cards"]');await h.click('[data-action="flip-card"]');
    await h.click('[data-action="back-home"]');await h.click('[data-action="library-tab"][data-tab="favorites"]');await h.click('[data-action="start-collection"][data-activity="cards"]');await h.click('[data-action="resume-cards"]');assert.equal(h.find('#card-counter').textContent,'Card 2 of 4');
    await h.click('[data-action="back-home"]');await h.click('[data-action="library-tab"][data-tab="sets"]');await cards(h);await h.click('[data-action="next-card"]');const saved=h.snapshot(),changed=structuredClone(h.set);changed.words[0].meaning='Changed meaning';h.close();h=await harness({saved,set:changed});await h.click('[data-action="open"]');await h.click('[data-activity="cards"]');assert.equal(h.find('[data-action="resume-cards"]'),null);
  }finally{h.close();}
});
function sampleDays(){
  const span=(year,month,day,ms)=>{const start=new Date(year,month-1,day,10).getTime();return [[start,start+ms]];};
  return {'2026-09-30':{answered:1,correct:1,flips:2,intervals:span(2026,9,30,300000)},'2026-10-17':{answered:4,correct:3,flips:5,intervals:span(2026,10,17,900000)},'2026-10-20':{answered:0,correct:0,flips:1,intervals:[]}};
}
test('study calendar shows recorded months, daily totals and zero-answer accuracy, and translates without moving the selection',async()=>{
  const saved={'wordnest-learning-v1:history':JSON.stringify({version:1,days:sampleDays()})},h=await harness({saved,hash:'#/stats'});
  try{
    assert.equal(h.find('#calendar-title').textContent.trim(),'Study calendar');assert.equal(h.w.document.querySelectorAll('.calendar-day').length,31);assert.equal(h.find('[data-date="2026-10-22"]').disabled,true);assert.equal(h.find('[data-offset="1"]').disabled,true);
    await h.click('[data-date="2026-10-17"]');assert.equal(h.find('[data-day-stat="totalTime"]').textContent,'15m 0s');assert.equal(h.find('[data-day-stat="answeredQuestions"]').textContent,'4');assert.equal(h.find('[data-day-stat="correctQuestions"]').textContent,'3');assert.equal(h.find('[data-day-stat="accuracy"]').textContent,'75%');assert.equal(h.find('[data-day-stat="cardFlips"]').textContent,'5');assert.equal(h.find('[data-date="2026-10-17"]').dataset.level,'3');assert.equal(h.w.document.activeElement.tagName,'BODY');
    await h.click('[data-date="2026-10-20"]');assert.equal(h.find('[data-day-stat="accuracy"]').textContent,'—');assert.equal(h.find('[data-date="2026-10-20"]').dataset.level,'1');
    await h.click('[data-offset="-1"]');assert.match(h.find('.calendar-navigation h3').textContent,/September 2026/);assert.equal(h.find('[data-offset="-1"]').disabled,true);await h.click('[data-date="2026-09-30"]');assert.equal(h.find('[data-day-stat="totalTime"]').textContent,'5m 0s');
    await h.click('[data-action="settings"]');h.find('#settings-language').value='ja';h.find('#settings-language').dispatchEvent(new h.w.Event('change',{bubbles:true}));await h.click('[data-dialog="cancel"]');assert.equal(h.find('#calendar-title').textContent.trim(),'学習カレンダー');assert.equal(h.find('#calendar-selected-title time').dateTime,'2026-09-30');assert.match(h.find('.calendar-navigation h3').textContent,/2026年9月/);
    assert.equal(h.find('[data-action="calendar-today"]'),null);await h.click('[data-offset="1"]');await h.click('[data-date="2026-10-21"]');assert.equal(h.find('#calendar-selected-title time').dateTime,'2026-10-21');assert.ok(h.find('.calendar-empty'));
    await h.click('[data-action="settings"]');await h.click('[data-delete-learning="statistics"]');await h.click('[data-dialog="confirm"]');await h.click('[data-dialog="cancel"]');assert.equal(h.find('[data-offset="-1"]').disabled,true);assert.equal(h.w.document.querySelectorAll('.calendar-day:not([data-level="0"])').length,0);
  }finally{h.close();}
});
test('deleting all learning data removes resumable decks; deleting statistics alone keeps the bookmark',async()=>{
  const h=await harness({lang:'ja'});
  try{
    await cards(h);await h.click('[data-action="next-card"]');await h.click('[data-action="back-home"]');
    await h.click('[data-action="settings"]');await h.click('[data-delete-learning="statistics"]');await h.click('[data-dialog="confirm"]');await h.click('[data-dialog="cancel"]');await h.click('[data-action="open"]');await h.click('[data-activity="cards"]');assert.equal(h.find('[data-action="resume-cards"]').textContent.trim(),'単語カードの続きから再開');
    await h.click('[data-action="settings"]');await h.click('[data-delete-learning="all"]');assert.match(h.find('#modal').textContent,/単語カードの再開位置/);await h.click('[data-dialog="confirm"]');await h.click('[data-dialog="cancel"]');assert.equal(h.find('[data-action="resume-cards"]'),null);
  }finally{h.close();}
});
