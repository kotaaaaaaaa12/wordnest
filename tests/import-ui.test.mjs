import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const origin='https://wordnest.example',password='import-testing-password';
const previous={title:'Vocabulary 1001–1050',words:[{english:'frustrate',meaning:'いらだたされる',explanation:''},{english:'nod',meaning:'うなずく',explanation:'(~dead; ~ding)'},{english:'stem',meaning:'由来する',explanation:'(~med; ~Ming)'}]};
const corrected={...previous,words:[{english:'frustrate',meaning:'いらだたせる',explanation:''},{english:'nod',meaning:'うなずく',explanation:'(~ded; ~ding)'},{english:'stem',meaning:'由来する',explanation:'(~med; ~ming)'}]};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check,label){for(let i=0;i<600;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(label);}
async function harness(){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:password}}));
  const login=await mf.dispatchFetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const request=(path,options={})=>mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,Cookie:cookie}});
  const old=(await (await request('/api/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(previous)})).json()).sets[0];
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:origin+'/#/edit',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,downloads=[];
  Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:download';};w.URL.revokeObjectURL=()=>{};const anchorClick=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(!this.hasAttribute('download'))return anchorClick.call(this);};
  w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.localStorage.setItem('wordnest-language','en');
  w.fetch=(path,options={})=>request(path,options);
  const find=s=>w.document.querySelector(s);
  async function click(selector){const element=find(selector);assert.ok(element,selector+' | '+w.location.hash+' | '+w.document.body.textContent.slice(-900));element.click();await tick();await tick();}
  function files(items){const picker=find('#import-files');Object.defineProperty(picker,'files',{configurable:true,value:items});return picker.onchange({target:picker});}
  async function importFile(file){await click('[data-action="import"]');await files([file]);await click('#import-confirm');await waitFor(()=>!find('#modal').open,'import completed');}
  w.eval(source);await waitFor(()=>find('[data-action="import"]') && find('.set-list button'),'editor loaded');
  return {w,find,click,files,importFile,request,old,downloads,async close(){w.close();await mf.dispose();}};
}
const jsonFile=(set,name='words.json')=>({name,size:JSON.stringify(set).length*3,text:async()=>JSON.stringify(set)});
test('latest selected JSON wins even if an older file finishes reading first',async()=>{
  const h=await harness(),slowOld=deferred(),slowNew=deferred();
  try{
    await h.click('[data-action="import"]');const oldRead=h.files([{name:'words.json',size:1000,text:()=>slowOld.promise}]),newRead=h.files([{name:'words.json',size:1000,text:()=>slowNew.promise}]);
    slowOld.resolve(JSON.stringify(previous));await oldRead;
    assert.equal(h.find('#import-confirm').disabled,true,'an obsolete file must not enable import while the new file is still reading');
    slowNew.resolve(JSON.stringify(corrected));await newRead;assert.equal(h.w.document.querySelectorAll('[data-import]').length,1,h.find('#modal').textContent);
    await h.click('#import-confirm');await waitFor(()=>!h.find('#modal').open,'corrected import');assert.equal(h.find('#word-0-meaning').value,'いらだたせる');assert.equal(h.find('#word-2-explanation').value,'(~med; ~ming)');
  }finally{slowOld.resolve('{}');slowNew.resolve('{}');await h.close();}
});
test('deleting the old set before importing corrected data keeps corrections after reload',async()=>{
  const h=await harness();
  try{
    await h.click('[data-action="manage-sets"]');await h.click('[data-manage-delete="'+h.old.id+'"]');await h.click('[data-manage-delete-confirm]');await waitFor(()=>!h.find('[data-manage-row="'+h.old.id+'"]'),'old set deleted');await h.click('[data-manage-close]');
    await h.importFile(jsonFile(corrected));const data=await (await h.request('/api/sets')).json();assert.equal(data.sets.length,1);const saved=data.sets[0];assert.notEqual(saved.id,h.old.id);assert.deepEqual(core.portable(saved),core.portable(corrected));
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="reload"]');await waitFor(()=>h.find('.set-card'),'reload completed');
    assert.ok(h.find('[data-action="open"][data-id="'+saved.id+'"]'));assert.equal(h.find('[data-action="open"][data-id="'+h.old.id+'"]'),null);
    await h.click('.nav [data-nav="edit"]');await h.click('[data-action="edit-set"][data-id="'+saved.id+'"]');assert.equal(h.find('#word-0-meaning').value,'いらだたせる');
  }finally{await h.close();}
});
test('corrected JSON and ZIP data persists in D1, survives reload, and exports without reverting',async()=>{
  const h=await harness();
  try{
    await h.importFile(jsonFile(corrected));let saved=(await (await h.request('/api/sets')).json()).sets.find(set=>set.id!==h.old.id);assert.deepEqual(core.portable(saved),core.portable(corrected));
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="reload"]');await waitFor(()=>h.find('.set-card'),'reload completed');await h.click('.nav [data-nav="edit"]');await h.click('[data-action="edit-set"][data-id="'+saved.id+'"]');assert.equal(h.find('#word-0-meaning').value,'いらだたせる');
    await h.click('[data-action="export-draft"]');assert.deepEqual(JSON.parse(await h.downloads.at(-1).text()),core.portable(corrected));
    const second={title:'Vocabulary 1101–1150',words:[{english:'mission',meaning:'①使命, 任務',explanation:'同語源'},{english:'organ',meaning:'①臓器',explanation:'[形]有機的な；生物の'}]},bytes=zip.zipSync({'001-words.json':zip.strToU8(JSON.stringify(core.portable(second)))});
    await h.importFile({name:'sets.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer});saved=(await (await h.request('/api/sets')).json()).sets.find(set=>set.title===second.title);assert.deepEqual(core.portable(saved),core.portable(second));
    assert.equal(h.find('#word-0-meaning').value,'①使命, 任務');assert.equal(h.find('#word-1-explanation').value,'[形]有機的な；生物の');
  }finally{await h.close();}
});

test('an obsolete read error cannot clear the latest selection or its content preview',async()=>{
  const h=await harness(),slowOld=deferred();
  try{
    await h.click('[data-action="import"]');const oldRead=h.files([{name:'old.json',size:100,text:()=>slowOld.promise}]);
    await h.files([jsonFile(corrected,'corrected.json')]);slowOld.resolve('invalid json');await oldRead;
    assert.equal(h.find('#import-error').hidden,true);assert.equal(h.find('#import-confirm').disabled,false);
    assert.match(h.find('#import-preview').textContent,/corrected\.json/);assert.match(h.find('#import-preview').textContent,/same title/);
    const details=h.find('[data-import-inspect="0"]');assert.equal(details.querySelector('ol').children.length,0);details.open=true;details.dispatchEvent(new h.w.Event('toggle'));
    assert.match(details.textContent,/いらだたせる/);assert.match(details.textContent,/~ming/);assert.doesNotMatch(details.textContent,/いらだたされる/);
  }finally{slowOld.resolve('{}');await h.close();}
});
test('a mismatched server response cannot report a successful import or allow a duplicate retry',async()=>{
  const h=await harness();
  try{
    const fetch=h.w.fetch;h.w.fetch=async(path,options={})=>{
      const response=await fetch(path,options);if(path!=='/api/sets' || options.method!=='POST')return response;
      const data=await response.json();data.sets[0].words[0].meaning=previous.words[0].meaning;
      return {ok:true,status:201,json:async()=>data};
    };
    await h.click('[data-action="import"]');await h.files([jsonFile(corrected)]);await h.click('#import-confirm');
    await waitFor(()=>!h.find('#import-error').hidden,'mismatch is reported');assert.equal(h.find('#modal').open,true);assert.equal(h.find('#import-confirm').disabled,true);assert.equal(h.find('#import-files').disabled,true);
    assert.match(h.find('#import-error').textContent,/server returned different content/);
    const sets=(await (await h.request('/api/sets')).json()).sets;assert.equal(sets.length,2);assert.deepEqual(core.portable(sets.find(set=>set.id!==h.old.id)),core.portable(corrected));
    await h.click('[data-dialog="cancel"]');assert.equal(h.find('#modal').open,false);
  }finally{await h.close();}
});
