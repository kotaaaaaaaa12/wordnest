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
test('both quiz directions retry only incorrect, skipped, and timed-out questions until mastered',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true});
  const studySet={...structuredClone(seed),words:structuredClone(seed.words.slice(0,5)),id:'seed',revision:1};
  const w=dom.window;w.document.hasFocus=()=>true;let now=1000,nextId=0,celebrations=0;const intervals=new Map();
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});
  w.Date.now=()=>now;w.setInterval=callback=>{const id=++nextId;intervals.set(id,callback);return id;};w.clearInterval=id=>intervals.delete(id);
  w.Audio=class{constructor(url){this.url=url;}play(){if(this.url.includes('confetti'))celebrations++;return Promise.resolve();}};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[studySet],orderRevision:0}:{authenticated:false,configured:true}});
  const find=selector=>w.document.querySelector(selector);
  const prompt=()=>find('.question-word').textContent;
  const savedProgress=()=>{try{return JSON.parse(w.localStorage.getItem('wordnest-progress')) || {};}catch{return {};}};
  async function click(selector){const element=find(selector);assert.ok(element,selector);element.click();await tick();await tick();}
  function advance(milliseconds){now+=milliseconds;for(const callback of [...intervals.values()])callback();}
  async function answer(mode,correct=true){
    const word=seed.words.find(word=>(mode==='en-ja'?word.english:word.meaning)===prompt());
    if(mode==='en-ja'){
      const option=[...w.document.querySelectorAll('.option')].find(button=>(button.textContent.slice(1)===word.meaning)===correct);assert.ok(option);option.click();
    }else{find('#typed-answer').value=correct?word.english:'an incorrect answer';find('#typed-answer').dispatchEvent(new w.Event('input',{bubbles:true}));find('#answer-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
    await tick();assert.ok(find('.feedback').textContent.includes(word.explanation));assert.equal(intervals.size,0);
    if(mode==='en-ja')for(const button of w.document.querySelectorAll('.option:not(.correct)')){const meaning=button.querySelector('[lang="ja"]').textContent;assert.equal(button.querySelector('.option-english').textContent,studySet.words.filter(word=>word.meaning===meaning).map(word=>word.english).join(' / '));}
  }
  try{
    w.localStorage.setItem('wordnest-progress','{invalid');
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();
    assert.equal(find('.set-card').dataset.studyStatus,'none');
    w.localStorage.setItem('wordnest-progress',JSON.stringify({seed:{key:core.studyKey(studySet),scope:'all','en-ja':true,'ja-en':true}}));
    await click('[data-action="reload"]');assert.equal(find('.set-card').dataset.studyStatus,'none');
    for(const [mode,round] of [['en-ja',0],['ja-en',1]]){
      await click('[data-action="open"]');await click('[data-activity="quiz"]');await click(`[data-mode="${mode}"]`);await click('[data-count="all"]');await click('[data-action="start"]');
      const missed=[],choices=new Map();
      for(let i=0;i<5;i++){
        if(i>0 && i<4)missed.push(prompt());
        if(mode==='en-ja')choices.set(prompt(),[...w.document.querySelectorAll('.option')].map(b=>b.textContent.slice(1)).sort());
        if(i===2)await click('[data-action="skip"]');else if(i===3)advance(mode==='ja-en'?20000:15000);else await answer(mode,i!==1);
        await click('[data-action="next"]');
      }
      assert.equal(find('.score-number').textContent.trim(),'2 / 5');assert.equal(core.studyStatus(studySet,savedProgress()),'none');assert.ok(find('[data-action="retry-mistakes"]').textContent.includes('3'));assert.equal(celebrations,round);
      await click('[data-action="retry-mistakes"]');assert.equal(find('.timer-seconds').textContent,mode==='ja-en'?'20s':'15s');assert.equal(find('.feedback'),null);assert.equal(intervals.size,1);
      const seen=[],retryPositions=[0,0,0,0];let lastMissed;
      for(let i=0;i<3;i++){
        seen.push(prompt());if(i===2)lastMissed=prompt();
        if(mode==='en-ja')assert.deepEqual([...w.document.querySelectorAll('.option')].map(b=>b.textContent.slice(1)).sort(),choices.get(prompt()));
        if(mode==='en-ja'){const answer=studySet.words.find(word=>word.english===prompt()).meaning;retryPositions[[...w.document.querySelectorAll('.option')].findIndex(option=>option.textContent.slice(1)===answer)]++;}
        await answer(mode,i<2);await click('[data-action="next"]');
      }
      if(mode==='en-ja')assert.ok(Math.max(...retryPositions)-Math.min(...retryPositions)<=1);
      assert.deepEqual([...seen].sort(),[...missed].sort());assert.equal(new Set(seen).size,3);assert.equal(find('.score-number').textContent.trim(),'2 / 3');assert.ok(find('[data-action="retry-mistakes"]').textContent.includes('1'));
      await click('[data-action="retry-mistakes"]');assert.equal(prompt(),lastMissed);assert.equal(find('.timer-seconds').textContent,mode==='ja-en'?'20s':'15s');if(mode==='en-ja')assert.equal(w.document.querySelectorAll('.option').length,4);await answer(mode);await click('[data-action="next"]');
      assert.equal(find('.score-number').textContent.trim(),'1 / 1');assert.equal(find('[data-action="retry-mistakes"]'),null);assert.equal(celebrations,round+1);assert.equal(intervals.size,0);await click('[data-action="back-home"]');
      assert.equal(find('.set-card').dataset.studyStatus,'none');
      assert.ok(find('.study-status').textContent.includes('Not cleared'));
      await click('[data-action="reload"]');
      assert.equal(find('.set-card').dataset.studyStatus,'none');
    }
    w.localStorage.removeItem('wordnest-progress');await click('[data-action="reload"]');
    assert.equal(find('.set-card').dataset.studyStatus,'none');
    await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-action="start"]');
    for(let i=0;i<5;i++){await answer('ja-en');if(i<4)assert.equal(w.localStorage.getItem('wordnest-progress'),null);await click('[data-action="next"]');}
    await click('[data-action="back-home"]');assert.equal(find('.set-card').dataset.studyStatus,'none');
    await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-action="start"]');
    for(let i=0;i<5;i++){await answer('ja-en',i!==0);await click('[data-action="next"]');}
    await click('[data-action="retry-mistakes"]');await answer('ja-en');await click('[data-action="next"]');await click('[data-action="back-home"]');assert.equal(find('.set-card').dataset.studyStatus,'none');
    for(const kind of ['custom','all']){
      await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click(`[data-count="${kind}"]`);
      if(kind==='custom'){find('#custom-count').value='5';find('#custom-count').dispatchEvent(new w.Event('input',{bubbles:true}));}
      await click('[data-action="start"]');
      for(let i=0;i<5;i++){await answer('ja-en');await click('[data-action="next"]');}
      await click('[data-action="back-home"]');assert.equal(find('.set-card').dataset.studyStatus,kind==='all'?'ja-en':'none');
    }
    await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="en-ja"]');await click('[data-count="all"]');await click('[data-action="start"]');
    for(let i=0;i<5;i++){await answer('en-ja');await click('[data-action="next"]');}
    await click('[data-action="back-home"]');assert.equal(find('.set-card').dataset.studyStatus,'both');
    const persisted=w.localStorage.getItem('wordnest-progress');assert.ok(persisted);
    await click('[data-action="reload"]');assert.equal(find('.set-card').dataset.studyStatus,'both');
    studySet.words[0].english='updated-word';studySet.words[0].meaning='Updated meaning';studySet.title='Edited set';studySet.words.push({english:'new-word',meaning:'New meaning',explanation:''});
    await click('[data-action="reload"]');assert.equal(find('.set-card').dataset.studyStatus,'both');
    studySet.words.pop();studySet.words[0]=structuredClone(seed.words[0]);
    w.localStorage.setItem('wordnest-progress',JSON.stringify({seed:{key:'previous-content',scope:'all-first-pass','ja-en':true}}));
    await click('[data-action="reload"]');assert.equal(find('.set-card').dataset.studyStatus,'ja-en');
    await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="en-ja"]');await click('[data-count="all"]');await click('[data-action="start"]');
    for(let i=0;i<5;i++){await answer('en-ja');await click('[data-action="next"]');}
    await click('[data-action="back-home"]');assert.equal(find('.set-card').dataset.studyStatus,'both');
    const afterEditing=w.localStorage.getItem('wordnest-progress');
    await click('[data-action="open"]');await click('[data-activity="cards"]');await click('[data-mode="en-ja"]');await click('[data-action="start-cards"]');
    for(let i=0;i<seed.words.length;i++)await click('[data-action="flip-card"]');
    await click('[data-action="back-home"]');assert.equal(w.localStorage.getItem('wordnest-progress'),afterEditing);
    w.localStorage.setItem('wordnest-progress','[]');await click('[data-action="reload"]');assert.equal(find('.set-card').dataset.studyStatus,'none');
  }finally{dom.window.close();}
});
