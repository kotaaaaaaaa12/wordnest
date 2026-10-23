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
const quizWords=[
  {english:'contemporary',meaning:'現代の',ipa:'kəntémpərèri',ipaItalic:[[8,9]]},
  {english:'parallel',meaning:'平行の',ipa:'pǽrəlèl'},
  {english:'version',meaning:'版',ipa:'və́ːrʒən',ipaItalic:[[4,5]]},
  {english:'term',meaning:'用語',ipa:'tə́ːrm',ipaItalic:[[4,5]]}
];
async function harness({supported=true,lang='en',mode='en-ja',activity='cards',words=seed.words,count=1,voices=[{lang:'ja-JP',default:true},{lang:'en-US',localService:true,name:'English'}]}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const utterances=[],requests=[];let current=null,cancels=0,now=1000,nextInterval=0;const intervals=new Map();
  if(activity==='quiz'){w.Date.now=()=>now;w.setInterval=callback=>{const id=++nextInterval;intervals.set(id,callback);return id;};w.clearInterval=id=>intervals.delete(id);}
  function advance(ms){now+=ms;for(const callback of [...intervals.values()])callback();}
  if(supported){w.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};w.speechSynthesis={getVoices:()=>voices,speak(utterance){current=utterance;utterances.push(utterance);},cancel(){cancels++;current?.onerror?.({error:'canceled'});current=null;}};}
  w.fetch=async path=>{requests.push(path);return {ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[{...seed,words,id:'seed',revision:1}],orderRevision:0}:{authenticated:false,configured:true}};};
  w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-sound','off');
  const find=s=>w.document.querySelector(s);async function click(s){const el=find(s);assert.ok(el,s);el.click();await tick();await tick();}
  const flips=()=>new statistics.LearningTracker({storage:w.localStorage,id:'observer'}).snapshot().flips;
  w.eval(source);await tick();await tick();await click('[data-action="open"]');await click('[data-activity="'+activity+'"]');await click('[data-mode="'+mode+'"]');
  if(activity==='cards')await click('[data-action="start-cards"]');else{await click('[data-count="custom"]');find('#custom-count').value=String(count);find('#custom-count').dispatchEvent(new w.Event('input',{bubbles:true}));await click('[data-action="start"]');}
  return {w,find,click,utterances,requests,flips,advance,cancels:()=>cancels,close:()=>w.close()};
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
test('tapping visible card text or its face flips in both directions while speaker taps and swipe clicks stay separate',async()=>{
  for(const mode of ['en-ja','ja-en']){
    const h=await harness({mode});
    try{
      await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('[data-action="flip-card"]').getAttribute('aria-pressed'),'true','the visible word must flip the card');assert.equal(h.flips(),1);
      await h.click('.flashcard-back .eyebrow');assert.equal(h.find('[data-action="flip-card"]').getAttribute('aria-pressed'),'false','the back face must flip to the front');assert.equal(h.flips(),2);
      await h.click('.flashcard-inner');assert.equal(h.flips(),3);await h.click('[data-action="flip-card"]');assert.equal(h.flips(),4);
      if(mode==='ja-en')await h.click('.flashcard-front .flashcard-text');const flips=h.flips();await h.click('[data-action="speak-card"]');assert.equal(h.flips(),flips);assert.equal(h.utterances.length,1);
      const card=h.find('.flashcard');for(const [type,x] of [['pointerdown',240],['pointermove',140],['pointerup',140]]){const event=new h.w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:120,button:0});Object.defineProperty(event,'pointerId',{value:7});card.dispatchEvent(event);}
      assert.equal(h.find('.flashcard-front .flashcard-text').textContent,mode==='en-ja'?'adapt':'適応する');await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('[data-action="flip-card"]').getAttribute('aria-pressed'),'false','the synthesized click after a swipe must not flip the next card');
    }finally{h.close();}
  }
});
test('EN to JP reveals only the distractor English words after correct, incorrect, skipped, and timed-out answers',async()=>{
  for(const outcome of ['correct','incorrect','skip','timeout']){
    const h=await harness({activity:'quiz',words:quizWords});
    try{
      const word=quizWords.find(word=>word.english===h.find('.question-word').textContent);
      assert.equal(h.find('.option-english'),null);assert.equal(h.find('.card-ipa').textContent,'['+word.ipa+']');
      assert.equal(h.find('.question-card img'),null);
      const ipaLetter=word.ipaItalic?.[0];assert.equal(h.find('.card-ipa i')?.textContent,ipaLetter?word.ipa.slice(...ipaLetter):undefined);
      const options=[...h.w.document.querySelectorAll('.option')];
      if(outcome==='timeout')h.advance(15000);
      else if(outcome==='skip')await h.click('[data-action="skip"]');
      else{options.find(button=>(button.querySelector('[lang="ja"]').textContent===word.meaning)===(outcome==='correct')).click();await tick();}
      assert.ok(h.find('.feedback'));assert.equal(h.w.document.querySelectorAll('.option-english').length,3);
      for(const button of h.w.document.querySelectorAll('.option')){
        assert.equal(button.tagName,'DIV');assert.equal(button.querySelector('[data-action="answer"]'),null);const meaning=button.querySelector('[lang="ja"]').textContent;
        if(meaning===word.meaning)assert.equal(button.querySelector('.option-english'),null);
        else{
          const expected=quizWords.find(word=>word.meaning===meaning),row=button.querySelector('.option-pronunciation');
          assert.equal(row.querySelector('.option-english-word').textContent,expected.english);assert.equal(row.querySelector('.card-ipa').textContent,'['+expected.ipa+']');
          const italic=expected.ipaItalic?.[0];assert.equal(row.querySelector('i')?.textContent,italic?expected.ipa.slice(...italic):undefined);
          row.querySelector('button').click();assert.equal(h.utterances.at(-1).text,expected.english);
        }
        assert.equal(button.querySelector('button button'),null);
      }
      assert.equal(new statistics.LearningTracker({storage:h.w.localStorage,id:'observer'}).snapshot().answered,1);assert.equal(h.find('.options [data-action="answer"]'),null);
    }finally{h.close();}
  }
});
test('quiz speech starts manually, restarts without queues, never extends the deadline, and stops on question changes and dialogs',async()=>{
  const h=await harness({activity:'quiz',words:quizWords,count:2});
  try{
    assert.equal(h.utterances.length,0);const requests=h.requests.length,word=h.find('.question-word').textContent,button=h.find('[data-action="speak-quiz"]');
    button.click();assert.equal(h.utterances.at(-1).text,word);assert.equal(h.utterances.at(-1).lang,'en-US');assert.equal(h.requests.length,requests);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(h.find('.feedback'),null);
    button.click();assert.equal(h.cancels(),1);assert.equal(h.utterances.length,2);h.advance(5000);assert.equal(h.find('.timer-seconds').textContent,'10s');
    await h.click('[data-action="settings"]');assert.equal(h.cancels(),2);await h.click('[data-dialog="cancel"]');assert.equal(h.utterances.length,2);
    await h.click('[data-action="speak-quiz"]');h.advance(10000);assert.equal(h.find('.feedback h3').textContent,messages.en.timedOut);assert.equal(h.cancels(),3);assert.equal(h.find('[data-action="speak-quiz"]').getAttribute('aria-busy'),'false');
    await h.click('[data-action="speak-quiz"]');await h.click('[data-action="next"]');assert.equal(h.cancels(),4);assert.equal(h.find('.timer-seconds').textContent,'15s');assert.equal(h.find('.option-english'),null);
    await h.click('[data-action="speak-quiz"]');h.w.dispatchEvent(new h.w.Event('blur'));assert.equal(h.cancels(),5);
    await h.click('[data-action="speak-quiz"]');await h.click('[data-action="skip"]');assert.equal(h.cancels(),6);
  }finally{h.close();}
});
test('JP to EN keeps pronunciation hidden until feedback then pairs each accepted word with IPA and its own speaker',async()=>{
  const words=quizWords.slice(0,2).map(word=>({...word,meaning:'共通の意味'}));
  for(const outcome of ['correct','incorrect','skip','timeout']){
    const h=await harness({activity:'quiz',mode:'ja-en',lang:'ja',words});
    try{
      assert.equal(h.find('.card-ipa'),null);assert.equal(h.find('[data-action="speak-quiz"]'),null);assert.equal(h.find('.quiz-correct-answer'),null);assert.equal(h.find('.timer-seconds').textContent,'20秒');
      const forged=h.w.document.createElement('button');forged.dataset.action='speak-quiz';forged.dataset.quizWord='0';h.find('.quiz').append(forged);forged.click();assert.equal(h.utterances.length,0);forged.remove();
      h.advance(15000);assert.equal(h.find('.feedback'),null);assert.equal(h.find('.timer-seconds').textContent,'5秒');
      if(outcome==='timeout')h.advance(5000);
      else if(outcome==='skip')await h.click('[data-action="skip"]');
      else{h.find('#typed-answer').value=outcome==='correct'?words[0].english:'wrong';h.find('#typed-answer').dispatchEvent(new h.w.Event('input',{bubbles:true}));h.find('#answer-form').dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await tick();}
      const rows=[...h.w.document.querySelectorAll('.quiz-answer-word')];assert.equal(rows.length,2);assert.equal(h.utterances.length,0);
      for(const [index,row] of rows.entries()){
        assert.equal(row.querySelector('strong').textContent,words[index].english);assert.equal(row.querySelector('.card-ipa').textContent,'['+words[index].ipa+']');assert.equal(row.querySelector('button').getAttribute('aria-label'),'「'+words[index].english+'」の発音を聞く');row.querySelector('button').click();assert.equal(h.utterances.at(-1).text,words[index].english);
      }
      assert.equal(rows[0].querySelector('i').textContent,words[0].ipa.slice(...words[0].ipaItalic[0]));
    }finally{h.close();}
  }
});
test('quiz IPA and answers remain usable without speech support and unregistered IPA adds no empty label',async()=>{
  for(const mode of ['en-ja','ja-en']){
    const words=quizWords.map(word=>({...word,ipa:undefined,ipaItalic:undefined})),h=await harness({activity:'quiz',mode,supported:false,words});
    try{assert.equal(h.find('[data-action="speak-quiz"]'),null);assert.equal(h.find('.card-ipa'),null);await h.click('[data-action="skip"]');assert.equal(h.find('[data-action="speak-quiz"]'),null);assert.equal(h.find('.card-ipa'),null);assert.ok(h.find('.feedback'));if(mode==='en-ja')assert.equal(h.w.document.querySelectorAll('.option-english').length,3);else assert.ok(h.find('.quiz-answer-word strong'));}
    finally{h.close();}
  }
});
