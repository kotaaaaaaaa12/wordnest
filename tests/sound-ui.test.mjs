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
async function harness({webAudio=true,muted=false,decodeFailure=false,missing=false,resumeGate}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  let now=1000,nextId=0;const intervals=new Map(),media=[],contexts=[],requests=[],decodes=[],starts=[];
  w.Date.now=()=>now;w.setInterval=callback=>{const id=++nextId;intervals.set(id,callback);return id;};w.clearInterval=id=>intervals.delete(id);
  const find=selector=>w.document.querySelector(selector),screen=()=>({feedback:find('.feedback h3')?.textContent,result:!!find('.score-number')});
  w.Audio=class{constructor(url){this.url=url;this.loads=0;this.plays=[];media.push(this);}load(){this.loads++;}pause(){this.paused=true;}play(){this.paused=false;this.plays.push(screen());return Promise.resolve();}};
  if(webAudio)w.AudioContext=class{
    constructor(options){this.options=options;this.state='suspended';contexts.push(this);}
    async decodeAudioData(bytes){
      const name=new TextDecoder().decode(bytes);decodes.push(name);if(decodeFailure)throw new Error('Invalid file');
      const samples=new Float32Array(1000);samples[50]=0.5;
      return {name,length:1000,numberOfChannels:1,sampleRate:1000,getChannelData:()=>samples};
    }
    resume(){this.resumes=(this.resumes||0)+1;if(resumeGate)return resumeGate.then(()=>{this.state='running';});this.state='running';return Promise.resolve();}
    createBufferSource(){const node={connect(){},disconnect(){},stop(){this.stopped=true;},start(when,offset){starts.push({name:this.buffer.name,when,offset,node,...screen()});}};return node;}
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
test('decoded effects preload once, skip leading silence, and start synchronously after answer feedback without a new request',async()=>{
  const h=await harness();
  try{
    assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].options.latencyHint,'interactive');assert.deepEqual([...h.decodes].sort(),['confetti','correct','incorrect']);assert.equal(h.starts.length,0);
    await h.start();assert.equal(h.contexts[0].state,'running');const requests=h.requests.length,button=h.correct();button.click();
    assert.equal(h.starts.length,1);assert.equal(h.starts[0].name,'correct');assert.equal(h.starts[0].feedback,messages.en.correct);assert.equal(h.starts[0].when,0);assert.ok(Math.abs(h.starts[0].offset-0.045)<1e-9);assert.equal(h.requests.length,requests);assert.equal(h.media.reduce((sum,audio)=>sum+audio.plays.length,0),0);
    button.click();assert.equal(h.starts.length,1);await h.click('[data-action="next"]');assert.equal(h.starts[0].node.stopped,true);h.advance(15000);assert.equal(h.starts[1].name,'incorrect');assert.equal(h.starts[1].feedback,messages.en.timedOut);assert.equal(h.requests.length,requests);assert.equal(h.decodes.length,3);
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
test('a suspended context never blocks feedback or replays a stale result after a slow resume',async()=>{
  const gate=deferred(),h=await harness({resumeGate:gate.promise});
  try{
    await h.start();h.correct().click();assert.ok(h.find('.feedback'));assert.equal(h.starts.length,0);await h.click('[data-action="next"]');gate.resolve();await tick();await tick();assert.equal(h.starts.length,0);assert.equal(h.find('.feedback'),null);
    await h.click('[data-action="skip"]');assert.equal(h.starts.length,1);assert.equal(h.starts[0].name,'incorrect');h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.starts[0].node.stopped,true);
  }finally{gate.resolve();h.close();}
});
test('unsupported Web Audio, decode failures, and missing files retain the nonblocking media fallback without repeated loads',async()=>{
  for(const options of [{webAudio:false},{decodeFailure:true},{missing:true}]){
    const h=await harness(options);
    try{
      await h.start(1);assert.ok(h.media.every(audio=>audio.loads===1));h.correct().click();const correct=h.media.find(audio=>audio.url.endsWith('/correct.mp3'));assert.equal(correct.plays.length,1);assert.equal(correct.plays[0].feedback,messages.en.correct);assert.equal(h.starts.length,0);assert.ok(h.media.every(audio=>audio.loads===1));await h.click('[data-action="next"]');assert.ok(h.find('.score-number'));
    }finally{h.close();}
  }
});
