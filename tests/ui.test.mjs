import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { icon } from '../public/icons.js';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
import { seed } from './fixture.js';
const css=await readFile('public/styles.css','utf8');
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('UI: edit, quizzes, flashcards and gestures, theme settings, ZIP and JSON transfers',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.document.hasFocus=()=>true;let sets=[{...structuredClone(seed),id:'seed',revision:1}],authed=false,confettiPlays=0,orderRevision=0;const downloads=[];
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});
  w.Audio=class{constructor(url){this.url=url;}play(){if(this.url.includes('confetti'))confettiPlays++;return Promise.resolve();}};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};const anchorClick=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(!this.hasAttribute('download'))return anchorClick.call(this);};
  w.fetch=async(path,options={})=>{let data;
    if(path==='/api/session')data={authenticated:authed,configured:true};
    else if(path==='/api/sets'&&options.method==='POST'){const incoming=JSON.parse(options.body);const created=(incoming.sets||[incoming]).map((s,i)=>({...s,id:`new-${sets.length+i}`,revision:1}));sets.unshift(...created);data={sets:created,orderRevision:++orderRevision,orderedIds:sets.map(s=>s.id)};}
    else if(path==='/api/sets')data={sets:structuredClone(sets),orderRevision};
    else if(path==='/api/sets/order' && options.method==='PUT'){const incoming=JSON.parse(options.body);assert.equal(incoming.revision,orderRevision);const entries=new Map(sets.map(s=>[s.id,s]));sets=incoming.ids.map(id=>entries.get(id));data={ok:true,orderRevision:++orderRevision,orderedIds:sets.map(s=>s.id)};}
    else if(path.startsWith('/api/sets/') && options.method==='DELETE'){const url=new URL(path,'https://wordnest.example');const id=url.pathname.split('/').at(-1);sets=sets.filter(s=>s.id!==id);data={ok:true,orderRevision:++orderRevision,orderedIds:sets.map(s=>s.id)};}
    else if(path.startsWith('/api/sets/') && options.method==='PUT'){const incoming=JSON.parse(options.body),id=path.split('/').at(-1);const entry=sets.find(s=>s.id===id);Object.assign(entry,incoming,{revision:entry.revision+1});data={set:structuredClone(entry)};}
    else if(path==='/api/login'){authed=true;data={ok:true};}
    else throw new Error(path);
    return {ok:true,status:200,json:async()=>data};
  };
  const style=w.document.createElement('style');style.textContent=css;w.document.head.append(style);
  const find=s=>w.document.querySelector(s);
  async function click(selector){const element=find(selector);assert.ok(element,selector);element.click();await tick();await tick();}
  function input(selector,value){const element=find(selector);assert.ok(element,selector);element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));}
  function submit(selector){find(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
  try{
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();assert.equal(w.document.querySelectorAll('.set-card').length,1);assert.equal(find('[data-action="new"]'),null);assert.equal(find('[data-select]'),null);assert.equal(find('[data-action="import"]'),null);
    assert.deepEqual([...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.dataset.nav),['home','stats','rankings','guide']);
    await click('.nav [data-nav="guide"]');assert.equal(w.location.hash,'#/guide');assert.equal(find('.guide-view h1').textContent,'How to use Wordnest');assert.equal(w.document.querySelectorAll('.guide-section').length,7);assert.equal(w.document.querySelectorAll('.guide-legend li').length,4);assert.ok(find('.nav [data-nav="guide"]').classList.contains('active'));assert.equal(find('.set-card'),null);
    await click('.nav [data-nav="home"]');assert.equal(w.location.hash,'#/');assert.ok(find('.set-card'));
    await click('[data-action="settings"]');assert.equal(find('[data-settings-action]'),null);const theme=find('#theme-choice');theme.value='light';theme.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.documentElement.dataset.theme,'light');theme.value='dark';theme.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.documentElement.dataset.theme,'dark');assert.equal(w.localStorage.getItem('wordnest-theme'),'dark');assert.equal(w.getComputedStyle(find('#modal-title')).outline,'none');await click('[data-dialog="cancel"]');
    assert.equal(find('[data-nav="edit"]'),null);await click('[data-action="settings"]');assert.equal(find('[data-action="new"]'),null);assert.equal(find('[data-action="import"]'),null);assert.equal(find('[data-action="export"]'),null);input('#admin-password','a-long-testing-password');submit('#admin-login-form');await tick();await tick();assert.equal(find('[data-admin-open]'),null);await click('[data-dialog="cancel"]');await click('.nav [data-nav="edit"]');
    await click('[data-action="new"]');input('#set-title','Four words');
    await click('.nav [data-nav="guide"]');assert.ok(find('#modal-title'));await click('[data-dialog="cancel"]');assert.equal(w.location.hash,'#/edit');assert.equal(find('#set-title').value,'Four words');assert.equal(find('.guide-view'),null);
    const words=[['apple','りんご'],['book','本'],['cat','猫'],['dog','犬']];
    for(let i=0;i<4;i++){if(i)await click('[data-action="add-word"]');input(`#word-${i}-english`,words[i][0]);input(`#word-${i}-meaning`,words[i][1]);}
    input('#word-0-explanation','A useful word.');await click('[data-action="save"]');assert.equal(sets[0].title,'Four words');assert.equal(sets[0].words.length,4);assert.equal(find('#dirty-label').textContent,'');
    await click('.nav [data-nav="home"]');await click(`[data-action="open"][data-id="${sets[0].id}"]`);await click('[data-activity="quiz"]');await click('[data-mode="en-ja"]');assert.ok(find('[data-count="5"]').disabled);await click('[data-count="all"]');await click('[data-action="start"]');
    await click('[data-action="quit"]');assert.equal(find('#modal-title').textContent,'End this practice?');assert.equal(w.getComputedStyle(find('#modal-title')).outline,'none');await click('[data-dialog="cancel"]');
    const prompts=[];
    for(let i=0;i<4;i++){const prompt=find('.question-word').textContent;prompts.push(prompt);const meaning=words.find(([en])=>en===prompt)[1];const option=[...w.document.querySelectorAll('.option')].find(b=>b.textContent.slice(1)===meaning);assert.ok(option);option.click();await tick();await click('[data-action="next"]');}
    assert.equal(new Set(prompts).size,4);assert.equal(confettiPlays,1);assert.equal(w.document.querySelectorAll('.review-item').length,4);
    await click('[data-action="back-home"]');await click(`[data-action="open"][data-id="${sets[0].id}"]`);await click('[data-activity="quiz"]');await click('[data-mode="ja-en"]');await click('[data-count="custom"]');input('#custom-count','2');await click('[data-action="start"]');
    for(let i=0;i<2;i++){const meaning=find('.question-word').textContent;input('#typed-answer',words.find(([,ja])=>ja===meaning)[0].toUpperCase());submit('#answer-form');await tick();assert.ok(find('.feedback:not(.wrong)'));await click('[data-action="next"]');}
    assert.equal(confettiPlays,2);
    await click('[data-action="again"]');await click('[data-action="start"]');for(let i=0;i<2;i++){await click('[data-action="skip"]');assert.ok(find('.feedback.wrong'));await click('[data-action="next"]');}assert.equal(confettiPlays,2);
    await click('[data-action="back-home"]');await click(`[data-action="open"][data-id="${sets[0].id}"]`);assert.ok(find('[data-activity="cards"]'));await click('[data-activity="cards"]');await click('[data-mode="en-ja"]');assert.ok(find('[data-order="original"]'));await click('[data-order="reverse"]');await click('[data-action="start-cards"]');
    assert.equal(find('.flashcard-front .flashcard-text').textContent,'dog');assert.ok(find('[data-action="previous-card"]').disabled);await click('[data-action="flip-card"]');assert.equal(find('.flashcard').getAttribute('aria-pressed'),'true');assert.equal(find('.flashcard-back .flashcard-text').textContent,'犬');await click('[data-action="next-card"]');assert.equal(find('.flashcard-front .flashcard-text').textContent,'cat');assert.equal(find('.flashcard').getAttribute('aria-pressed'),'false');await click('[data-action="previous-card"]');
    function pointer(type,x,y){const ev=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(ev,'pointerId',{value:1});find('.flashcard').dispatchEvent(ev);}
    pointer('pointerdown',240,180);pointer('pointermove',140,180);pointer('pointerup',140,180);assert.equal(find('.flashcard-front .flashcard-text').textContent,'cat');await click('[data-action="flip-card"]');assert.equal(find('.flashcard').getAttribute('aria-pressed'),'false');
    pointer('pointerdown',140,180);pointer('pointermove',240,180);pointer('pointerup',240,180);assert.equal(find('.flashcard-front .flashcard-text').textContent,'dog');
    pointer('pointerdown',140,180);pointer('pointermove',145,280);pointer('pointerup',145,280);assert.equal(find('.flashcard-front .flashcard-text').textContent,'dog');
    pointer('pointerdown',240,180);pointer('pointermove',140,180);pointer('pointercancel',140,180);assert.equal(find('.flashcard-front .flashcard-text').textContent,'dog');
    w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(find('.flashcard-front .flashcard-text').textContent,'cat');w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(find('.flashcard-front .flashcard-text').textContent,'dog');w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',bubbles:true}));assert.equal(find('.flashcard').getAttribute('aria-pressed'),'true');
    await click('[data-action="back-order"]');await click('[data-action="back-mode"]');await click('[data-mode="ja-en"]');await click('[data-order="original"]');await click('[data-action="start-cards"]');assert.equal(find('.flashcard-front .flashcard-text').textContent,'りんご');assert.equal(find('.flashcard-back .flashcard-text').textContent,'apple');w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',bubbles:true}));assert.equal(find('.card-explanation p').textContent,'A useful word.');
    for(let i=0;i<3;i++)await click('[data-action="next-card"]');assert.ok(find('[data-action="next-card"]').disabled);assert.equal(find('.flashcard-front .flashcard-text').textContent,'犬');
    await click('[data-action="back-order"]');await click('[data-order="random"]');await click('[data-action="start-cards"]');const seen=[];for(let i=0;i<4;i++){seen.push(find('.flashcard-back .flashcard-text').textContent);if(i<3)await click('[data-action="next-card"]');}assert.equal(new Set(seen).size,4);assert.deepEqual(sets[0].words.map(w=>w.english),words.map(w=>w[0]));assert.equal(confettiPlays,2);
    await click('[data-action="back-home"]');await click('.nav [data-nav="edit"]');await click('[data-action="export"]');await click('[data-export-all]');await click('#export-confirm');assert.equal(downloads.length,1);const zipBytes=new Uint8Array(await downloads[0].arrayBuffer());assert.equal(Object.keys(zip.unzipSync(zipBytes)).length,2);
    await click('.nav [data-nav="edit"]');await click('[data-action="import"]');const picker=find('#import-files');Object.defineProperty(picker,'files',{value:[{name:'sets.json',size:1000,text:async()=>JSON.stringify({sets:[{title:'Import one',words:sets[0].words},{title:'Import two',words:sets[0].words}]})}]});await picker.onchange({target:picker});assert.equal(w.document.querySelectorAll('[data-import]').length,2);find('[data-import="1"]').click();await tick();await click('#import-confirm');assert.equal(sets.length,3);assert.equal(sets[0].title,'Import one');assert.equal(find('#modal').hasAttribute('open'),false);
    await click('[data-action="import"]');const zipPicker=find('#import-files');const zipped=zip.zipSync({'first.json':zip.strToU8(JSON.stringify({title:'ZIP import',words:sets[0].words}))});Object.defineProperty(zipPicker,'files',{value:[{name:'sets.zip',size:zipped.length,arrayBuffer:async()=>zipped.buffer}]});await zipPicker.onchange({target:zipPicker});assert.equal(w.document.querySelectorAll('[data-import]').length,1);await click('#import-confirm');assert.equal(sets.length,4);assert.equal(sets[0].title,'ZIP import');
    const beforeManagement=sets.map(s=>s.id),draftId=sets[0].id;input('#set-title','An unsaved title');
    await click('[data-action="manage-sets"]');assert.ok(find(`[data-manage-up="${beforeManagement[0]}"]`).disabled);assert.ok(find(`[data-manage-down="${beforeManagement.at(-1)}"]`).disabled);await click(`[data-manage-down="${beforeManagement[0]}"]`);assert.deepEqual(sets.map(s=>s.id),beforeManagement);
    await click('[data-manage-close]');assert.ok(find('[data-manage-discard]'));await click('[data-manage-keep]');await click('#save-set-order');assert.deepEqual(sets.map(s=>s.id),[beforeManagement[1],beforeManagement[0],...beforeManagement.slice(2)]);assert.ok(find('#save-set-order').disabled);await click('[data-manage-close]');assert.equal(find('#set-title').value,'An unsaved title');assert.equal(find('#dirty-label').textContent,'Unsaved changes');
    const fixedOrder=sets.map(s=>s.id);await click('[data-action="save"]');assert.deepEqual(sets.map(s=>s.id),fixedOrder);
    await click('[data-action="manage-sets"]');await click(`[data-manage-down="${fixedOrder[0]}"]`);await click('[data-manage-close]');await click('[data-manage-discard]');assert.deepEqual(sets.map(s=>s.id),fixedOrder);
    await click('[data-action="manage-sets"]');await click('[data-manage-delete="seed"]');await click('[data-manage-cancel]');assert.equal(sets.length,4);await click('[data-manage-delete="seed"]');await click('[data-manage-delete-confirm]');assert.equal(sets.length,3);assert.equal(find('[data-manage-row="seed"]'),null);await click('[data-manage-close]');assert.equal(find('[data-action="edit-set"][data-id="seed"]'),null);
    input('#set-title','A draft to delete');await click('[data-action="manage-sets"]');await click(`[data-manage-delete="${draftId}"]`);assert.ok(find('.manage-confirm').textContent.includes('unsaved draft'));await click('[data-manage-delete-confirm]');assert.equal(sets.length,2);await click('[data-manage-close]');assert.equal(find('#set-title'),null);assert.ok(find('.editor-panel .empty'));
    await click('.nav [data-nav="home"]');assert.deepEqual([...w.document.querySelectorAll('.card-open')].map(b=>b.dataset.id),sets.map(s=>s.id));await click('.nav [data-nav="edit"]');
    await click('[data-action="settings"]');const language=find('#settings-language');language.value='ja';language.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.documentElement.lang,'ja');assert.equal(find('#modal-title').textContent,'設定');await click('[data-dialog="cancel"]');assert.ok(find('.edit-heading h1').textContent.includes('単語'));
    await click('.nav [data-nav="guide"]');assert.equal(find('.nav [data-nav="guide"]').textContent.trim(),'説明');assert.equal(find('.guide-view h1').textContent,'使い方');assert.ok(find('#guide-cards+ul').textContent.includes('単語カード'));assert.ok(find('.guide-view').textContent.includes('このブラウザ'));assert.ok(find('.guide-view').textContent.includes('両方向クリア'));
    await click('[data-action="settings"]');find('#settings-language').value='en';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));await click('[data-dialog="cancel"]');assert.equal(find('.guide-view h1').textContent,'How to use Wordnest');assert.equal(find('.nav [data-nav="guide"]').textContent.trim(),'Guide');assert.ok(find('.guide-view').textContent.includes('15-second'));
  }finally{dom.window.close();}
});

test('Guide deep link stays available when word set loading fails',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/guide',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.document.hasFocus=()=>true;
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});
  w.Audio=class{play(){return Promise.resolve();}};
  w.fetch=async()=>{throw new Error('Offline');};
  try{
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();
    assert.equal(w.document.querySelector('.guide-view h1').textContent,'How to use Wordnest');
    assert.ok(w.document.querySelector('.nav [data-nav="guide"]').classList.contains('active'));
    w.document.querySelector('.nav [data-nav="home"]').click();await tick();await tick();
    assert.equal(w.location.hash,'#/');assert.equal(w.document.querySelector('.guide-view'),null);assert.ok(w.document.querySelector('.empty'));
    w.location.hash='#/guide';await new Promise(resolve=>setTimeout(resolve,10));await tick();
    assert.ok(w.document.querySelector('.guide-view'));assert.equal(w.location.hash,'#/guide');
  }finally{w.close();}
});
