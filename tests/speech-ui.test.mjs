import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import {icon} from '../public/icons.js';
import {messages,translator} from '../public/i18n.js';
import * as zip from 'fflate';
import {seed} from './fixture.js';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function harness({supported=true,lang='en',mode='en-ja',voices=[{lang:'ja-JP',default:true},{lang:'en-US',localService:true,name:'English'}]}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const utterances=[],requests=[];let current=null,cancels=0;
  if(supported){w.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};w.speechSynthesis={getVoices:()=>voices,speak(utterance){current=utterance;utterances.push(utterance);},cancel(){cancels++;current?.onerror?.({error:'canceled'});current=null;}};}
  w.fetch=async path=>{requests.push(path);return {ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[{...seed,id:'seed',revision:1}],orderRevision:0}:{authenticated:false,configured:true}};};
  w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-sound','off');
  const find=s=>w.document.querySelector(s);async function click(s){const el=find(s);assert.ok(el,s);el.click();await tick();await tick();}
  const flips=()=>new statistics.LearningTracker({storage:w.localStorage,id:'observer'}).snapshot().flips;
  w.eval(source);await tick();await tick();await click('[data-action="open"]');await click('[data-activity="cards"]');await click('[data-mode="'+mode+'"]');await click('[data-action="start-cards"]');
  return {w,find,click,utterances,requests,flips,cancels:()=>cancels,close:()=>w.close()};
}
test('the speaker reads English synchronously without flipping, recording a flip, fetching audio, or queueing repeated taps',async()=>{
  const h=await harness();
  try{
    const button=h.find('[data-action="speak-card"]');assert.equal(button.closest('.flashcard-face').getAttribute('aria-hidden'),'false');assert.equal(h.find('.flashcard button button'),null);assert.equal(button.getAttribute('aria-label'),'Hear the pronunciation of achieve');
    const requests=h.requests.length;button.click();assert.equal(h.utterances.length,1,'speech begins in the click gesture');const first=h.utterances[0];assert.equal(first.text,'achieve');assert.equal(first.lang,'en-US');assert.equal(first.voice.name,'English');assert.equal(first.rate,1);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(h.flips(),0);assert.equal(h.find('[data-action="flip-card"]').getAttribute('aria-pressed'),'false');assert.equal(h.requests.length,requests);
    const staleEnd=first.onend;button.click();assert.equal(h.cancels(),1);assert.equal(h.utterances.length,2);staleEnd();assert.equal(button.getAttribute('aria-busy'),'true');h.utterances[1].onend();assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(h.flips(),0);
    const key=new h.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});button.dispatchEvent(key);assert.equal(key.defaultPrevented,false);assert.equal(h.flips(),0,'native button activation must not be consumed as a flip');
    const down=new h.w.MouseEvent('pointerdown',{bubbles:true,clientX:200,clientY:100,button:0});Object.defineProperty(down,'pointerId',{value:1});button.dispatchEvent(down);const up=new h.w.MouseEvent('pointerup',{bubbles:true,clientX:80,clientY:100,button:0});Object.defineProperty(up,'pointerId',{value:1});button.dispatchEvent(up);assert.equal(h.find('.flashcard-front .flashcard-text').textContent,'achieve');
    await h.click('[data-action="flip-card"]');assert.equal(button.disabled,true);assert.equal(button.tabIndex,-1);button.click();assert.equal(h.utterances.length,2);assert.equal(h.flips(),1);
  }finally{h.close();}
});
test('JP to EN enables pronunciation only after revealing English and stops playback on card changes, dialogs, and navigation',async()=>{
  const h=await harness({lang:'ja',mode:'ja-en'});
  try{
    let button=h.find('[data-action="speak-card"]');assert.equal(button.disabled,true);assert.equal(button.closest('.flashcard-face').getAttribute('aria-hidden'),'true');button.click();assert.equal(h.utterances.length,0);
    await h.click('[data-action="flip-card"]');assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-label'),'「achieve」の発音を聞く');button.click();assert.equal(h.utterances.at(-1).text,'achieve');
    await h.click('[data-action="next-card"]');assert.equal(h.cancels(),1);assert.equal(h.find('[data-action="speak-card"]').disabled,true);
    await h.click('[data-action="flip-card"]');await h.click('[data-action="speak-card"]');assert.equal(h.utterances.at(-1).text,'adapt');await h.click('[data-action="settings"]');assert.equal(h.cancels(),2);await h.click('[data-dialog="cancel"]');assert.equal(h.utterances.length,2,'closing a modal does not autoplay');
    await h.click('[data-action="speak-card"]');await h.click('[data-action="back-home"]');assert.equal(h.cancels(),3);
  }finally{h.close();}
});
test('late voice availability, English fallback, speech errors, and background cleanup stay usable',async()=>{
  const voices=[],h=await harness({voices});
  try{
    await h.click('[data-action="speak-card"]');assert.equal(h.utterances[0].lang,'en-US');assert.equal(h.utterances[0].voice,undefined);h.utterances[0].onerror({error:'voice-unavailable'});assert.equal(h.find('#toast').textContent,messages.en.speechError);assert.equal(h.find('[data-action="speak-card"]').getAttribute('aria-busy'),'false');
    voices.push({lang:'en-GB',default:true,name:'British English'});await h.click('[data-action="speak-card"]');assert.equal(h.utterances.at(-1).voice.name,'British English');h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.cancels(),1);
    await h.click('[data-action="speak-card"]');Object.defineProperty(h.w.document,'visibilityState',{configurable:true,value:'hidden'});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));assert.equal(h.cancels(),2);assert.equal(h.find('[data-action="speak-card"]').getAttribute('aria-busy'),'false');
    h.w.speechSynthesis.speak=()=>{throw new Error('Unavailable');};await h.click('[data-action="speak-card"]');assert.equal(h.find('#toast').textContent,messages.en.speechError);assert.equal(h.find('[data-action="speak-card"]').getAttribute('aria-busy'),'false');
  }finally{h.close();}
});
test('unsupported browsers retain flashcard flips, arrows, swipes, and readable content without a speaker button',async()=>{
  const h=await harness({supported:false});
  try{assert.equal(h.find('[data-action="speak-card"]'),null);assert.equal(h.find('.flashcard-front .flashcard-text').textContent,'achieve');await h.click('[data-action="flip-card"]');assert.equal(h.flips(),1);await h.click('[data-action="next-card"]');assert.equal(h.find('.flashcard-front .flashcard-text').textContent,'adapt');h.w.document.body.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:' ',bubbles:true}));assert.equal(h.flips(),2);}
  finally{h.close();}
});
