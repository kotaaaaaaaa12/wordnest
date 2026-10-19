import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
import { seed } from './fixture.js';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function harness({lang='en',authenticated=false}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  Object.assign(w,core,statistics,personalTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  w.Audio=class{play(){return Promise.resolve();}};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const requests=[],set={...structuredClone(seed),id:'seed',revision:1};
  w.fetch=async(path,options={})=>{requests.push([path,options.method || 'GET']);return {ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[set],orderRevision:0}:{authenticated,configured:true}};};
  w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-theme','dark');w.localStorage.setItem('wordnest-dark-palette','midnight');w.localStorage.setItem('unrelated-data','keep');
  const personal=new personalTools.PersonalWords(w.localStorage),question=personalTools.sourceQuestions([set],'en-ja')[0],word=personalTools.wordIdentity(set.id,set.words[0]);
  function seedData(){
    w.localStorage.setItem('wordnest-progress',JSON.stringify({[set.id]:{scope:'all-first-pass',key:core.studyKey(set),'en-ja':true,'ja-en':true}}));
    personal.answer(question.sources,false);personal.answer(question.sources,false);personal.toggleFavorite(word);
    const tracker=new statistics.LearningTracker({storage:w.localStorage,id:'seed-stats'});tracker.answer(true);tracker.flip();
  }
  function status(){const stats=new statistics.LearningTracker({storage:w.localStorage,id:'reader'}).snapshot();return {clears:!!w.localStorage.getItem('wordnest-progress'),weak:personal.record(question.sources[0].key).weak,favorites:personal.favorite(word),statistics:stats.answered>0};}
  const find=s=>w.document.querySelector(s);
  async function click(s){assert.ok(find(s),s);find(s).click();await tick();await tick();}
  seedData();w.eval(source);await tick();await tick();
  return {w,find,click,status,requests,set,word,question};
}
test('all five Settings deletion choices confirm their scope, cancel safely, and delete only the selected category',async()=>{
  for(const type of ['clears','weak','favorites','statistics','all']){
    const {w,find,click,status,requests}=await harness();
    try{
      await click('[data-action="settings"]');
      assert.equal(w.document.querySelectorAll('[data-delete-learning]').length,5);
      const sections=[...w.document.querySelectorAll('#modal .settings-section')];assert.ok(sections.at(-2).classList.contains('settings-data'));assert.equal(sections.at(-1).id,'admin-controls');
      await click(`[data-delete-learning="${type}"]`);assert.ok(find('#modal-title').textContent.startsWith('Delete'));assert.ok(find('#modal').textContent.includes('This cannot be undone.'));assert.equal(find('#admin-password'),null);
      await click('[data-dialog="cancel"]');assert.deepEqual(status(),{clears:true,weak:true,favorites:true,statistics:true});assert.ok(find('.settings-data'));
      await click(`[data-delete-learning="${type}"]`);const event=new w.Event('cancel',{cancelable:true});find('#modal').dispatchEvent(event);await tick();await tick();assert.deepEqual(status(),{clears:true,weak:true,favorites:true,statistics:true});assert.ok(find('#admin-password'));
      await click(`[data-delete-learning="${type}"]`);await click('[data-dialog="confirm"]');
      assert.deepEqual(status(),Object.fromEntries(['clears','weak','favorites','statistics'].map(key=>[key,type!=='all' && type!==key])));
      assert.ok(find('#admin-password'));assert.equal(find('#toast').textContent,messages.en.learningDataDeleted);
      assert.equal(w.localStorage.getItem('wordnest-theme'),'dark');assert.equal(w.localStorage.getItem('wordnest-dark-palette'),'midnight');assert.equal(w.localStorage.getItem('wordnest-language'),'en');assert.equal(w.localStorage.getItem('unrelated-data'),'keep');
      assert.ok(requests.every(([,method])=>method==='GET'));
      await click('[data-dialog="cancel"]');assert.equal(w.document.querySelectorAll('.set-card').length,1);
      assert.equal(find('.set-card').dataset.studyStatus,type==='clears'||type==='all'?'none':'both');
      await click('.nav [data-nav="stats"]');assert.equal(find('[data-stat="answeredQuestions"]').textContent,type==='statistics'||type==='all'?'0':'1');
    }finally{w.close();}
  }
});
test('Japanese deletion dialogs are localized and deleting all learning data preserves administrator access',async()=>{
  const {w,find,click,status}=await harness({lang:'ja',authenticated:true});
  try{
    await click('[data-action="settings"]');assert.equal(find('#learning-data-title').textContent,'学習データの削除');assert.equal(find('[data-delete-learning="all"]').textContent.trim(),'すべての学習データを削除');
    for(const [type,name] of [['clears','クリア状況'],['weak','苦手単語'],['favorites','お気に入り'],['statistics','学習記録'],['all','すべての学習データ']]){
      await click(`[data-delete-learning="${type}"]`);assert.equal(find('#modal-title').textContent,`「${name}」を削除しますか？`);assert.ok(find('#modal').textContent.includes('この操作は取り消せません。'));await click('[data-dialog="cancel"]');
    }
    await click('[data-delete-learning="all"]');await click('[data-dialog="confirm"]');assert.deepEqual(status(),{clears:false,weak:false,favorites:false,statistics:false});assert.ok(find('[data-admin-open]'));assert.ok(find('.nav [data-nav="edit"]'));
  }finally{w.close();}
});
test('storage deletion errors show an error without falsely reporting success',async()=>{
  const {w,find,click,status}=await harness();
  const original=w.Storage.prototype.removeItem;
  try{
    await click('[data-action="settings"]');await click('[data-delete-learning="clears"]');w.Storage.prototype.removeItem=function(){throw new Error('Storage blocked');};
    await click('[data-dialog="confirm"]');assert.equal(status().clears,true);assert.equal(find('#toast').textContent,messages.en.deleteDataError);assert.ok(find('.settings-data'));
  }finally{w.Storage.prototype.removeItem=original;w.close();}
});
