import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
import { seed } from './fixture.js';
const css=await readFile('public/styles.css','utf8');
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('UI: create and save a set, complete both quizzes, export ZIP, and import selected JSON sets',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;let sets=[{...structuredClone(seed),id:'seed',revision:1}],authed=false,confettiPlays=0;const downloads=[];
  Object.assign(w,core,{messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:true})});
  w.Audio=class{constructor(url){this.url=url;}play(){if(this.url.includes('confetti'))confettiPlays++;return Promise.resolve();}};
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};const anchorClick=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(!this.hasAttribute('download'))return anchorClick.call(this);};
  w.fetch=async(path,options={})=>{let data;
    if(path==='/api/session')data={authenticated:authed,configured:true};
    else if(path==='/api/sets'&&options.method==='POST'){const incoming=JSON.parse(options.body);const created=(incoming.sets||[incoming]).map((s,i)=>({...s,id:`new-${sets.length+i}`,revision:1}));sets.unshift(...created);data={sets:created};}
    else if(path==='/api/sets')data={sets:structuredClone(sets)};
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
    w.eval(source);await tick();await tick();assert.equal(w.document.querySelectorAll('.set-card').length,1);assert.equal(find('[data-action="new"]'),null);assert.equal(find('[data-select]'),null);assert.equal(find('[data-action="import"]'),null);
    await click('[data-action="settings"]');const theme=find('#theme-choice');theme.value='light';theme.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.documentElement.dataset.theme,'light');theme.value='dark';theme.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.documentElement.dataset.theme,'dark');assert.equal(w.localStorage.getItem('wordnest-theme'),'dark');assert.equal(w.getComputedStyle(find('#modal-title')).outline,'none');await click('[data-dialog="cancel"]');
    await click('[data-nav="edit"]:not(.brand)');input('#password','a-long-testing-password');submit('#login-form');await tick();await tick();
    await click('[data-action="settings"]');await click('[data-settings-action="new"]');input('#set-title','Four words');
    const words=[['apple','りんご'],['book','本'],['cat','猫'],['dog','犬']];
    for(let i=0;i<4;i++){if(i)await click('[data-action="add-word"]');input(`#word-${i}-english`,words[i][0]);input(`#word-${i}-meaning`,words[i][1]);}
    await click('[data-action="save"]');assert.equal(sets[0].title,'Four words');assert.equal(sets[0].words.length,4);assert.equal(find('#dirty-label').textContent,'');
    await click('.nav [data-nav="home"]');await click(`[data-action="open"][data-id="${sets[0].id}"]`);await click('[data-mode="en-ja"]');assert.ok(find('[data-count="5"]').disabled);await click('[data-count="all"]');await click('[data-action="start"]');
    await click('[data-action="quit"]');assert.equal(find('#modal-title').textContent,'End this practice?');assert.equal(w.getComputedStyle(find('#modal-title')).outline,'none');await click('[data-dialog="cancel"]');
    const prompts=[];
    for(let i=0;i<4;i++){const prompt=find('.question-word').textContent;prompts.push(prompt);const meaning=words.find(([en])=>en===prompt)[1];const option=[...w.document.querySelectorAll('.option')].find(b=>b.textContent.slice(1)===meaning);assert.ok(option);option.click();await tick();await click('[data-action="next"]');}
    assert.equal(new Set(prompts).size,4);assert.equal(confettiPlays,1);assert.equal(w.document.querySelectorAll('.review-item').length,4);
    await click('[data-action="back-home"]');await click(`[data-action="open"][data-id="${sets[0].id}"]`);await click('[data-mode="ja-en"]');await click('[data-count="custom"]');input('#custom-count','2');await click('[data-action="start"]');
    for(let i=0;i<2;i++){const meaning=find('.question-word').textContent;input('#typed-answer',words.find(([,ja])=>ja===meaning)[0].toUpperCase());submit('#answer-form');await tick();assert.ok(find('.feedback:not(.wrong)'));await click('[data-action="next"]');}
    assert.equal(confettiPlays,2);
    await click('[data-action="again"]');await click('[data-action="start"]');for(let i=0;i<2;i++){await click('[data-action="skip"]');assert.ok(find('.feedback.wrong'));await click('[data-action="next"]');}assert.equal(confettiPlays,2);
    await click('[data-action="back-home"]');await click('[data-action="settings"]');await click('[data-settings-action="export"]');await click('[data-export-all]');await click('#export-confirm');assert.equal(downloads.length,1);const zipBytes=new Uint8Array(await downloads[0].arrayBuffer());assert.equal(Object.keys(zip.unzipSync(zipBytes)).length,2);
    await click('.nav [data-nav="edit"]');await click('[data-action="settings"]');await click('[data-settings-action="import"]');const picker=find('#import-files');Object.defineProperty(picker,'files',{value:[{name:'sets.json',size:1000,text:async()=>JSON.stringify({sets:[{title:'Import one',words:sets[0].words},{title:'Import two',words:sets[0].words}]})}]});await picker.onchange({target:picker});assert.equal(w.document.querySelectorAll('[data-import]').length,2);find('[data-import="1"]').click();await tick();await click('#import-confirm');assert.equal(sets.length,3);assert.equal(sets[0].title,'Import one');assert.equal(find('#modal').hasAttribute('open'),false);
    await click('[data-action="settings"]');await click('[data-settings-action="import"]');const zipPicker=find('#import-files');const zipped=zip.zipSync({'first.json':zip.strToU8(JSON.stringify({title:'ZIP import',words:sets[0].words}))});Object.defineProperty(zipPicker,'files',{value:[{name:'sets.zip',size:zipped.length,arrayBuffer:async()=>zipped.buffer}]});await zipPicker.onchange({target:zipPicker});assert.equal(w.document.querySelectorAll('[data-import]').length,1);await click('#import-confirm');assert.equal(sets.length,4);assert.equal(sets[0].title,'ZIP import');
    await click('[data-action="settings"]');const language=find('#settings-language');language.value='ja';language.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.documentElement.lang,'ja');assert.equal(find('#modal-title').textContent,'設定');await click('[data-dialog="cancel"]');assert.ok(find('.edit-heading h1').textContent.includes('単語'));
  }finally{dom.window.close();}
});
