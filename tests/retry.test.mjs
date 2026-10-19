import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
import { seed } from './fixture.js';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('both quiz directions retry only incorrect, skipped, and timed-out questions until mastered',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;let now=1000,nextId=0,celebrations=0;const intervals=new Map();
  Object.assign(w,core,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});
  w.Date.now=()=>now;w.setInterval=callback=>{const id=++nextId;intervals.set(id,callback);return id;};w.clearInterval=id=>intervals.delete(id);
  w.Audio=class{constructor(url){this.url=url;}play(){if(this.url.includes('confetti'))celebrations++;return Promise.resolve();}};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[{...seed,id:'seed',revision:1}],orderRevision:0}:{authenticated:false,configured:true}});
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
  }
  try{
    w.localStorage.setItem('wordnest-progress','{invalid');
    w.eval(source);await tick();await tick();
    assert.equal(find('.set-card').dataset.studyStatus,'none');
    for(const [mode,round] of [['en-ja',0],['ja-en',1]]){
      await click('[data-action="open"]');await click('[data-activity="quiz"]');await click(`[data-mode="${mode}"]`);await click('[data-action="start"]');
      const missed=[],choices=new Map();
      for(let i=0;i<5;i++){
        if(i>0 && i<4)missed.push(prompt());
        if(mode==='en-ja')choices.set(prompt(),[...w.document.querySelectorAll('.option')].map(b=>b.textContent.slice(1)).sort());
        if(i===2)await click('[data-action="skip"]');else if(i===3)advance(15000);else await answer(mode,i!==1);
        await click('[data-action="next"]');
      }
      assert.equal(find('.score-number').textContent.trim(),'2 / 5');assert.equal(core.studyStatus({...seed,id:'seed'},savedProgress()),round?'en-ja':'none');assert.ok(find('[data-action="retry-mistakes"]').textContent.includes('3'));assert.equal(celebrations,round);
      await click('[data-action="retry-mistakes"]');assert.equal(find('.timer-seconds').textContent,'15s');assert.equal(find('.feedback'),null);assert.equal(intervals.size,1);
      const seen=[];let lastMissed;
      for(let i=0;i<3;i++){
        seen.push(prompt());if(i===2)lastMissed=prompt();
        if(mode==='en-ja')assert.deepEqual([...w.document.querySelectorAll('.option')].map(b=>b.textContent.slice(1)).sort(),choices.get(prompt()));
        await answer(mode,i<2);await click('[data-action="next"]');
      }
      assert.deepEqual([...seen].sort(),[...missed].sort());assert.equal(new Set(seen).size,3);assert.equal(find('.score-number').textContent.trim(),'2 / 3');assert.ok(find('[data-action="retry-mistakes"]').textContent.includes('1'));
      await click('[data-action="retry-mistakes"]');assert.equal(prompt(),lastMissed);assert.equal(find('.timer-seconds').textContent,'15s');if(mode==='en-ja')assert.equal(w.document.querySelectorAll('.option').length,4);await answer(mode);await click('[data-action="next"]');
      assert.equal(find('.score-number').textContent.trim(),'1 / 1');assert.equal(find('[data-action="retry-mistakes"]'),null);assert.equal(celebrations,round+1);assert.equal(intervals.size,0);await click('[data-action="back-home"]');
      assert.equal(find('.set-card').dataset.studyStatus,round?'both':'en-ja');
      assert.ok(find('.study-status').textContent.includes(round?'Both cleared':'EN → JP cleared'));
      await click('[data-action="reload"]');
      assert.equal(find('.set-card').dataset.studyStatus,round?'both':'en-ja');
    }
    w.localStorage.removeItem('wordnest-progress');await click('[data-action="reload"]');
    assert.equal(find('.set-card').dataset.studyStatus,'none');
    await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-action="start"]');
    for(let i=0;i<5;i++){await answer('ja-en');if(i<4)assert.equal(w.localStorage.getItem('wordnest-progress'),null);await click('[data-action="next"]');}
    await click('[data-action="back-home"]');assert.equal(find('.set-card').dataset.studyStatus,'ja-en');
    const persisted=w.localStorage.getItem('wordnest-progress');assert.ok(persisted);
    await click('[data-action="open"]');await click('[data-activity="cards"]');await click('[data-mode="en-ja"]');await click('[data-action="start-cards"]');
    for(let i=0;i<seed.words.length;i++)await click('[data-action="flip-card"]');
    await click('[data-action="back-home"]');assert.equal(w.localStorage.getItem('wordnest-progress'),persisted);
    w.localStorage.setItem('wordnest-progress','[]');await click('[data-action="reload"]');assert.equal(find('.set-card').dataset.studyStatus,'none');
  }finally{dom.window.close();}
});
