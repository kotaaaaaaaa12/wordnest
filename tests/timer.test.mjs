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
test('mode-specific quiz clocks handle 15/20-second deadlines, late answers, modal rerenders, and cleanup',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.document.hasFocus=()=>true;let now=1000,nextId=0;const intervals=new Map(),sounds=[];
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});
  w.Date.now=()=>now;w.setInterval=callback=>{const id=++nextId;intervals.set(id,callback);return id;};w.clearInterval=id=>intervals.delete(id);
  w.Audio=class{constructor(url){this.url=url;}play(){sounds.push(this.url);return Promise.resolve();}};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[{...seed,id:'seed',revision:1}],orderRevision:0}:{authenticated:false,configured:true}});
  const find=selector=>w.document.querySelector(selector);
  async function click(selector){const element=find(selector);assert.ok(element,selector);element.click();await tick();await tick();}
  function advance(milliseconds){now+=milliseconds;for(const callback of [...intervals.values()])callback();}
  function correctButton(){const prompt=find('.question-word').textContent,meaning=seed.words.find(word=>word.english===prompt).meaning;return [...w.document.querySelectorAll('.option')].find(button=>button.textContent.slice(1)===meaning);}
  try{
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();await click('[data-action="open"]');find('[data-activity="quiz"]').focus();await click('[data-activity="quiz"]');assert.ok([...w.document.querySelectorAll('[data-mode]')].every(button=>button!==w.document.activeElement));
    const direction=find('[data-mode="en-ja"]');direction.focus();const down=new w.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});direction.dispatchEvent(down);assert.equal(down.defaultPrevented,true);await click('[data-mode="en-ja"]');assert.notEqual(w.document.activeElement,direction);
    await click('[data-action="start"]');assert.equal(find('.timer-seconds').textContent,'15s');assert.equal(find('.timer-track').getAttribute('aria-valuenow'),'15');assert.equal(intervals.size,1);const prompt=find('.question-word').textContent;
    advance(5000);assert.equal(find('.timer-seconds').textContent,'10s');assert.equal(find('.question-timer').style.getPropertyValue('--timer-hue'),'80');assert.ok(find('.timer-fill').style.transform.includes('0.666'));
    await click('[data-action="settings"]');const language=find('#settings-language');language.value='ja';language.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(find('.timer-seconds').textContent,'10秒');await click('[data-dialog="cancel"]');assert.equal(intervals.size,1);
    advance(9999);assert.equal(find('.timer-seconds').textContent,'1秒');assert.equal(find('.question-timer').style.getPropertyValue('--timer-hue'),'0');advance(1);assert.equal(find('.timer-seconds').textContent,'0秒');assert.equal(find('.feedback h3').textContent,'時間切れ');assert.ok(find('.feedback.wrong'));assert.equal(find('.question-word').textContent,prompt);assert.equal(intervals.size,0);assert.ok([...w.document.querySelectorAll('.option')].every(button=>button.disabled));assert.equal(sounds.filter(s=>s.includes('incorrect')).length,1);
    await click('[data-action="next"]');assert.equal(find('.timer-seconds').textContent,'15秒');assert.equal(intervals.size,1);
    now+=15001;correctButton().click();await tick();assert.equal(find('.feedback h3').textContent,'時間切れ');assert.equal(intervals.size,0);assert.equal(sounds.filter(s=>s.includes('incorrect')).length,2);
    await click('[data-action="next"]');advance(3000);correctButton().click();await tick();assert.ok(find('.feedback:not(.wrong)'));assert.equal(find('.timer-seconds').textContent,'12秒');assert.equal(intervals.size,0);advance(30000);assert.equal(find('.timer-seconds').textContent,'12秒');assert.equal(sounds.filter(s=>s.includes('correct.mp3')&&!s.includes('incorrect')).length,1);
    await click('[data-action="next"]');await click('[data-action="quit"]');advance(15000);assert.ok(find('#modal').open);assert.equal(find('.feedback h3').textContent,'時間切れ');await click('[data-dialog="cancel"]');assert.equal(sounds.filter(s=>s.includes('incorrect')).length,3);
    await click('[data-action="next"]');assert.equal(find('.timer-seconds').textContent,'15秒');await click('[data-action="quit"]');await click('[data-dialog="confirm"]');assert.equal(find('.question-timer'),null);assert.equal(intervals.size,0);advance(30000);assert.equal(sounds.filter(s=>s.includes('incorrect')).length,3);
    await click('[data-action="open"]');await click('[data-activity="cards"]');await click('[data-mode="en-ja"]');await click('[data-action="start-cards"]');assert.ok(find('.flashcard'));assert.equal(find('.question-timer'),null);assert.equal(intervals.size,0);
    await click('[data-action="back-home"]');await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-count="custom"]');find('#custom-count').value='1';find('#custom-count').dispatchEvent(new w.Event('input',{bubbles:true}));await click('[data-action="start"]');
    assert.equal(find('.timer-seconds').textContent,'20秒');assert.equal(find('.timer-track').getAttribute('aria-valuemax'),'20');advance(5000);assert.equal(find('.timer-seconds').textContent,'15秒');assert.equal(find('.question-timer').style.getPropertyValue('--timer-hue'),'90');assert.ok(find('.timer-fill').style.transform.includes('0.75'));const word=seed.words.find(word=>word.meaning===find('.question-word').textContent).english;find('#typed-answer').value=word;find('#typed-answer').dispatchEvent(new w.Event('input',{bubbles:true}));now+=15000;w.document.dispatchEvent(new w.Event('visibilitychange'));assert.equal(find('.feedback h3').textContent,'時間切れ');assert.equal(find('#typed-answer').value,word);assert.ok(find('#typed-answer').disabled);assert.equal(intervals.size,0);await click('[data-action="next"]');assert.ok(find('.score-number').textContent.trim().startsWith('0'));assert.equal(sounds.filter(s=>s.includes('confetti')).length,0);
  }finally{dom.window.close();}
});
