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
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function harness({webAudio=true,muted=false,decodeFailure=false,missing=false,resumeGate,resumeFailure=false,sourceFailure}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  let now=1000,nextId=0;const intervals=new Map(),media=[],contexts=[],requests=[],decodes=[],starts=[];
  w.Date.now=()=>now;w.setInterval=callback=>{const id=++nextId;intervals.set(id,callback);return id;};w.clearInterval=id=>intervals.delete(id);
  const find=selector=>w.document.querySelector(selector),screen=()=>({feedback:find('.feedback h3')?.textContent,result:!!find('.score-number')});
  w.Audio=class{constructor(url){this.url=url;this.loads=0;this.plays=[];media.push(this);}load(){this.loads++;}pause(){this.paused=true;}play(){this.paused=false;this.plays.push(screen());return missing?Promise.reject(new Error('Missing audio file')):Promise.resolve();}};
  if(webAudio)w.AudioContext=class{
    constructor(options){this.options=options;this.state='suspended';contexts.push(this);}
    get currentTime(){return now/1000;}
    async decodeAudioData(bytes){
      const name=new TextDecoder().decode(bytes);decodes.push(name);if(decodeFailure)throw new Error('Invalid file');
      const samples=new Float32Array(1000);samples[50]=0.5;
      return {name,length:1000,numberOfChannels:1,sampleRate:1000,getChannelData:()=>samples};
    }
    resume(){this.resumes=(this.resumes||0)+1;if(resumeFailure)return Promise.reject(new Error('Audio is blocked'));if(resumeGate)return resumeGate.then(()=>{this.state='running';});this.state='running';return Promise.resolve();}
    createBufferSource(){if(sourceFailure==='create')throw new Error('Source unavailable');const node={connect(){if(sourceFailure==='connect')throw new Error('Output unavailable');},disconnect(){},stop(){this.stopped=true;},start(when,offset){if(sourceFailure==='start')throw new Error('Playback failed');starts.push({name:this.buffer.name,when,offset,node,...screen()});}};return node;}
  };
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>{
    requests.push(path);
    if(path.startsWith('/assets/audio/'))return {ok:!missing,arrayBuffer:async()=>new TextEncoder().encode(path.split('/').at(-1).split('.')[0]).buffer};
    return {ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[{...seed,id:'seed',revision:1}],orderRevision:0}:{authenticated:false,configured:true}};
  };
  async function click(selector){const element=find(selector);assert.ok(element,selector);element.click();await tick();await tick();}
  async function start(count=2){await click('[data-action="open"]');await click('[data-activity="quiz"]');await click('[data-mode="en-ja"]');await click('[data-count="custom"]');find('#custom-count').value=String(count);find('#custom-count').dispatchEvent(new w.Event('input',{bubbles:true}));await click('[data-action="start"]');}
  function correct(){const word=seed.words.find(word=>word.english===find('.question-word').textContent);return [...w.document.querySelectorAll('.option')].find(button=>button.querySelector('[lang="ja"]').textContent===word.meaning);}
  function advance(ms){now+=ms;for(const callback of [...intervals.values()])callback();}
  w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));if(muted)w.localStorage.setItem('wordnest-sound','off');w.eval(source);await tick();await tick();
  return {w,find,click,start,correct,advance,media,contexts,requests,decodes,starts,close:()=>w.close()};
}
test('decoded effects preload once and schedule playback 150 ms after feedback without a new request',async()=>{
  const h=await harness();
  try{
    assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].options.latencyHint,'interactive');assert.deepEqual([...h.decodes].sort(),['confetti','correct','incorrect']);assert.equal(h.starts.length,0);assert.ok(h.media.every(audio=>audio.preload==='auto' && audio.loads===1),'media fallback must be ready even after successful decoding');
    await h.start();assert.equal(h.contexts[0].state,'running');const requests=h.requests.length,button=h.correct();button.click();
    assert.equal(h.starts.length,1);assert.equal(h.starts[0].name,'correct');assert.equal(h.starts[0].feedback,messages.en.correct);assert.equal(h.starts[0].when,h.contexts[0].currentTime+0.15);assert.ok(Math.abs(h.starts[0].offset-0.045)<1e-9);assert.equal(h.requests.length,requests);assert.equal(h.media.reduce((sum,audio)=>sum+audio.plays.length,0),0);
    button.click();assert.equal(h.starts.length,1);await h.click('[data-action="next"]');assert.equal(h.starts[0].node.stopped,true,'changing questions cancels even a sound whose scheduled start has not arrived');h.advance(15000);assert.equal(h.starts[1].name,'incorrect');assert.equal(h.starts[1].feedback,messages.en.timedOut);assert.equal(h.starts[1].when,h.contexts[0].currentTime+0.15);assert.equal(h.requests.length,requests);assert.equal(h.decodes.length,3);
  }finally{h.close();}
});
test('perfect-result audio uses its prepared buffer and muting stops active effects without affecting quiz controls',async()=>{
  const h=await harness({muted:true});
  try{
    assert.equal(h.contexts.length,0);assert.equal(h.requests.some(path=>path.startsWith('/assets/audio/')),false);
    await h.click('[data-action="settings"]');await h.click('[data-settings-sound]');await h.click('[data-dialog="cancel"]');assert.equal(h.decodes.length,3);
    await h.start(1);h.correct().click();assert.equal(h.starts[0].name,'correct');await h.click('[data-action="next"]');assert.equal(h.starts[1].name,'confetti');assert.equal(h.starts[1].result,true);
    await h.click('[data-action="settings"]');await h.click('[data-settings-sound]');assert.equal(h.starts[1].node.stopped,true);assert.equal(h.w.localStorage.getItem('wordnest-sound'),'off');await h.click('[data-dialog="cancel"]');await h.click('[data-action="back-home"]');await h.start(1);await h.click('[data-action="skip"]');assert.equal(h.starts.length,2);
  }finally{h.close();}
});
test('a pending resume uses media immediately, retries on gestures, and cannot replay a stale result',async()=>{
  const gate=deferred(),h=await harness({resumeGate:gate.promise});
  try{
    await h.start();const resumes=h.contexts[0].resumes;h.correct().click();assert.ok(h.find('.feedback'));assert.equal(h.starts.length,0);const correct=h.media.find(audio=>audio.url.endsWith('/correct.mp3'));assert.equal(correct.plays.length,1,'media playback must start before awaiting resume');assert.equal(correct.plays[0].feedback,messages.en.correct);assert.ok(h.contexts[0].resumes>resumes,'a pending resume must not block further unlock attempts');await h.click('[data-action="next"]');assert.equal(correct.paused,true);gate.resolve();await tick();await tick();assert.equal(h.starts.length,0);assert.equal(correct.plays.length,1);assert.equal(h.find('.feedback'),null);
    await h.click('[data-action="skip"]');assert.equal(h.starts.length,1);assert.equal(h.starts[0].name,'incorrect');h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.starts[0].node.stopped,true);
  }finally{gate.resolve();h.close();}
});
test('a late successful resume does not double-play the current answer',async()=>{
  const gate=deferred(),h=await harness({resumeGate:gate.promise});
  try{
    await h.start();h.correct().click();const correct=h.media.find(audio=>audio.url.endsWith('/correct.mp3'));assert.equal(correct.plays.length,1);gate.resolve();await tick();await tick();assert.equal(h.starts.length,0);assert.equal(correct.plays.length,1);
  }finally{gate.resolve();h.close();}
});
test('rejected resumes, interrupted contexts, and closed contexts retain immediate media playback and timeout sounds',async()=>{
  for(const state of ['suspended','interrupted','closed']){
    const h=await harness({resumeFailure:true});
    try{
      await h.start();h.contexts[0].state=state;h.correct().click();const correct=h.media.find(audio=>audio.url.endsWith('/correct.mp3'));assert.equal(correct.plays.length,1);assert.equal(correct.plays[0].feedback,messages.en.correct);assert.equal(h.starts.length,0);
      await h.click('[data-action="next"]');h.advance(15000);const incorrect=h.media.find(audio=>audio.url.endsWith('/incorrect.mp3'));assert.equal(incorrect.plays.length,1);assert.equal(incorrect.plays[0].feedback,messages.en.timedOut);assert.ok(h.media.every(audio=>audio.loads===1));await tick();
    }finally{h.close();}
  }
});
test('Web Audio source failures fall back during the same answer handler',async()=>{
  for(const sourceFailure of ['create','connect','start']){
    const h=await harness({sourceFailure});
    try{
      await h.start(1);h.correct().click();const correct=h.media.find(audio=>audio.url.endsWith('/correct.mp3'));assert.equal(correct.plays.length,1);assert.equal(correct.plays[0].feedback,messages.en.correct);assert.equal(h.starts.length,0);
      await h.click('[data-action="next"]');const confetti=h.media.find(audio=>audio.url.endsWith('/confetti.mp3'));assert.equal(confetti.plays.length,1);assert.equal(confetti.plays[0].result,true);
    }finally{h.close();}
  }
});
test('unsupported Web Audio, decode failures, and missing files retain the nonblocking media fallback without repeated loads',async()=>{
  for(const options of [{webAudio:false},{decodeFailure:true},{missing:true}]){
    const h=await harness(options);
    try{
      await h.start(1);assert.ok(h.media.every(audio=>audio.loads===1));h.correct().click();const correct=h.media.find(audio=>audio.url.endsWith('/correct.mp3'));assert.equal(correct.plays.length,1);assert.equal(correct.plays[0].feedback,messages.en.correct);assert.equal(h.starts.length,0);assert.ok(h.media.every(audio=>audio.loads===1));await h.click('[data-action="next"]');assert.ok(h.find('.score-number'));assert.equal(h.media.find(audio=>audio.url.endsWith('/confetti.mp3')).plays.length,1);
    }finally{h.close();}
  }
});
