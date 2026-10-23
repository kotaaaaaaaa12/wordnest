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
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const first={id:'first',title:'Set A',revision:1,words:[['apple','りんご'],['book','本'],['cat','猫'],['dog','犬']].map(([english,meaning])=>({english,meaning,explanation:'A useful note.'}))};
const second={id:'second',title:'Set B',revision:1,words:[['egg','卵'],['fish','魚'],['goat','山羊'],['hat','帽子']].map(([english,meaning])=>({english,meaning,explanation:''}))};
function harness(hash='#/',authenticated=false) {
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/'+hash,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});w.document.hasFocus=()=>true;
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[first,second],orderRevision:0}:{authenticated,configured:true}});
  return {dom,w};
}
test('personal UI supports cross-context recovery, set selection, both collection activities, favorites, and search',async()=>{
  const {w}=harness(),personal=new personalTools.PersonalWords(w.localStorage),all=[first,second];
  const find=s=>w.document.querySelector(s),list=()=>[...w.document.querySelectorAll('.word-item')];
  const saved=()=>new personalTools.PersonalWords(w.localStorage);
  async function click(selector){const button=typeof selector==='string'?find(selector):selector;assert.ok(button,selector);button.click();await tick();await tick();}
  function input(selector,value){const element=find(selector);element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));}
  async function answer(correct=true){
    const prompt=find('.question-word').textContent,word=all.flatMap(set=>set.words).find(word=>word.meaning===prompt || word.english===prompt);
    if(find('#answer-form')){input('#typed-answer',correct?word.english:'incorrect');find('#answer-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
    else{const option=[...w.document.querySelectorAll('.option')].find(button=>(button.textContent.slice(1)===word.meaning)===correct);await click(option);}
    await tick();
  }
  async function originalRound(setId,correct=false){
    await click('.nav [data-nav="home"]');await click('[data-action="library-tab"][data-tab="sets"]');await click(`[data-action="open"][data-id="${setId}"]`);await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-count="all"]');await click('[data-action="start"]');
    for(let i=0;i<4;i++){if(correct)await answer();else await click('[data-action="skip"]');await click('[data-action="next"]');}
    await click('[data-action="back-home"]');
  }
  const question=(set,english,mode='ja-en')=>personalTools.sourceQuestions([set],mode).find(q=>q.english===english);
  try{
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();
    await originalRound('first');assert.equal(saved().record(question(first,'apple').sources[0].key).weak,false);
    await originalRound('first');assert.equal(saved().record(question(first,'apple').sources[0].key).weak,true);
    const other=question(second,'egg');personal.answer(other.sources,false);personal.answer(other.sources,false);
    await click('[data-action="library-tab"][data-tab="weak"]');await click('[data-action="weak-mode"][data-mode="ja-en"]');assert.equal(list().length,4);assert.equal(find('#weak-set').value,'first');
    await click('[data-action="weak-scope"][data-scope="combined"]');assert.equal(list().length,5);find('#weak-picker').open=true;await click('[data-action="weak-select-all"]');assert.equal(find('#weak-picker').open,true);assert.equal(list().length,0);assert.ok(find('[data-action="start-collection"][data-activity="quiz"]').disabled);
    await click('[data-weak-set="second"]');assert.equal(find('#weak-picker').open,true);assert.equal(list().length,1);await click('[data-action="start-collection"][data-activity="cards"]');await click('[data-action="start-cards"]');assert.equal(find('.flashcard-front .flashcard-text').textContent,'卵');assert.equal(find('.flashcard-back .flashcard-text').textContent,'egg');
    const beforeFlip=new statistics.LearningTracker({storage:w.localStorage,id:'reader'}).snapshot().flips;
    await click('.card-tools [data-action="favorite"]');assert.equal(find('[data-action="flip-card"]').getAttribute('aria-pressed'),'false');assert.equal(new statistics.LearningTracker({storage:w.localStorage,id:'reader'}).snapshot().flips,beforeFlip);assert.equal(saved().favorite(personalTools.wordIdentity(second.id,second.words[0])),true);
    await click('[data-action="flip-card"]');await click('[data-action="back-home"]');assert.equal(saved().record(other.sources[0].key).successes,0);
    await click('[data-action="library-tab"][data-tab="words"]');input('#word-search','ＡＰＰＬＥ');assert.equal(list().length,1);assert.ok(list()[0].textContent.includes('Set A'));
    await click('.word-detail');assert.ok(find('#modal').textContent.includes('A useful note.'));await click('#modal [data-action="favorite"]');assert.equal(find('#modal [data-action="favorite"]').getAttribute('aria-pressed'),'true');await click('[data-dialog="cancel"]');
    await click('[data-action="library-tab"][data-tab="favorites"]');assert.equal(list().length,2);find('#favorite-set').value='first';find('#favorite-set').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(list().length,1);
    await click('[data-action="start-collection"][data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-count="all"]');assert.ok(find('.notice').textContent.includes('do not award'));await click('[data-action="start"]');await answer();await click('[data-action="next"]');await click('[data-action="back-home"]');
    assert.equal(saved().record(question(first,'apple').sources[0].key).successes,1);assert.equal(w.localStorage.getItem('wordnest-progress'),null);
    await originalRound('first',true);assert.equal(saved().record(question(first,'apple').sources[0].key).successes,2);assert.equal(find('[data-set-id="first"]').dataset.studyStatus,'ja-en');
    await click('[data-action="library-tab"][data-tab="weak"]');await click('[data-action="weak-scope"][data-scope="single"]');find('#weak-set').value='first';find('#weak-set').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(list().length,4);
    await click('[data-action="start-collection"][data-activity="quiz"]');await click('[data-count="all"]');await click('[data-action="start"]');for(let i=0;i<4;i++){await answer();await click('[data-action="next"]');}await click('[data-action="back-home"]');assert.equal(list().length,3);assert.equal(saved().record(question(first,'apple').sources[0].key).weak,false);
    await originalRound('first',true);await click('[data-action="library-tab"][data-tab="weak"]');assert.equal(list().length,0);assert.equal(saved().favorite(personalTools.wordIdentity(first.id,first.words[0])),true);
    const english=question(second,'fish','en-ja');personal.answer(english.sources,false);personal.answer(english.sources,false);
    await click('[data-action="weak-mode"][data-mode="en-ja"]');assert.equal(find('#weak-set').value,'second');assert.equal(list().length,1);await click('[data-action="start-collection"][data-activity="quiz"]');await click('[data-action="start"]');assert.equal(w.document.querySelectorAll('.option').length,4);assert.ok([...w.document.querySelectorAll('.option')].every(option=>second.words.some(word=>word.meaning===option.textContent.slice(1))),'one weak word takes distractors from its own set');assert.ok(find('.quiz').textContent.includes('Question 1 of 1'));await answer();await click('[data-action="next"]');await click('[data-action="back-home"]');assert.equal(saved().record(english.sources[0].key).successes,1);
    await click('[data-action="library-tab"][data-tab="sets"]');assert.equal(find('[data-set-id="second"]').dataset.studyStatus,'none');
    await click('[data-action="library-tab"][data-tab="words"]');input('#word-search','りん');assert.equal(list().length,1);input('#word-search','not-a-word');assert.equal(list().length,0);assert.ok(find('.empty'));
    assert.ok(new statistics.LearningTracker({storage:w.localStorage,id:'reader'}).snapshot().answered>=22);
  }finally{w.close();}
});
test('document titles follow all main tabs, selected language, and direct links',async()=>{
  const {w}=harness('#/guide',true),find=s=>w.document.querySelector(s);
  async function click(selector){assert.ok(find(selector),selector);find(selector).click();await tick();await tick();}
  try{
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();assert.equal(w.document.title,'Wordnest — Guide');
    for(const [route,label] of [['stats','Statistics'],['edit','Edit'],['home','Practice'],['guide','Guide']]){await click(`.nav [data-nav="${route}"]`);assert.equal(w.document.title,`Wordnest — ${label}`);}
    await click('[data-action="settings"]');find('#settings-language').value='ja';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.title,'Wordnest — 説明');await click('[data-dialog="cancel"]');
    for(const [route,label] of [['stats','学習記録'],['edit','編集'],['home','学習'],['guide','説明']]){await click(`.nav [data-nav="${route}"]`);assert.equal(w.document.title,`Wordnest — ${label}`);}
  }finally{w.close();}
});
