import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import {icon} from '../public/icons.js';
import {messages,translator} from '../public/i18n.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,''),bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}),origin='https://wordnest.example';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check,label){for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(label);}
async function harness(lang='en'){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'ipa-testing-password'}}));
  const response=await mf.dispatchFetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'ipa-testing-password'})}),cookie=response.headers.get('set-cookie').split(';')[0];
  const request=(path,options={})=>mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,Cookie:cookie}});
  const initial={title:'Legacy words',words:[{english:'tea',meaning:'お茶',explanation:''},{english:'cat',meaning:'猫',explanation:''}]};
  const set=(await(await request('/api/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(initial)})).json()).sets[0];
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:origin+'/#/edit',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,downloads=[];
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:download';};w.URL.revokeObjectURL=()=>{};const anchorClick=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(!this.hasAttribute('download'))return anchorClick.call(this);};
  w.fetch=(path,options={})=>request(path,options);w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));
  const find=s=>w.document.querySelector(s);async function click(s){const element=find(s);assert.ok(element,s);element.click();await tick();await tick();}function input(s,value){const element=find(s);element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));}
  w.eval(source);await waitFor(()=>find('[data-action="edit-set"]'),'editor loaded');await click('[data-action="edit-set"]');return {w,mf,set,find,click,input,request,downloads,async close(){w.close();await mf.dispose();}};
}
test('IPA palette exists only for the focused input and inserts at the caret without stealing focus or losing selection',async()=>{
  const h=await harness();
  try{
    assert.equal(h.find('.ipa-palette'),null);h.find('#word-0-english').focus();assert.equal(h.find('.ipa-palette'),null);
    const input=h.find('#word-0-ipa');input.focus();assert.ok(h.find('#ipa-palette'));assert.equal(input.getAttribute('aria-controls'),'ipa-palette');h.input('#word-0-ipa','tiː');input.setSelectionRange(1,2);
    const symbol=h.find('[data-ipa-symbol="ə"]'),event=new h.w.MouseEvent('pointerdown',{bubbles:true,cancelable:true});symbol.dispatchEvent(event);assert.equal(event.defaultPrevented,true);await h.click('[data-ipa-symbol="ə"]');assert.equal(h.w.document.activeElement,input);assert.equal(input.value,'təː');assert.equal(input.selectionStart,2);assert.ok(h.find('.ipa-palette'));assert.equal(h.find('#dirty-label').textContent,messages.en.unsaved);
    input.setSelectionRange(0,0);await h.click('[data-ipa-symbol="ˈ"]');assert.equal(input.value,'ˈtəː');assert.equal(input.selectionStart,1);
    h.find('#word-0-meaning').focus();assert.equal(h.find('.ipa-palette'),null);assert.equal(input.hasAttribute('aria-controls'),false);h.find('#word-1-ipa').focus();assert.equal(h.w.document.querySelectorAll('.ipa-palette').length,1);assert.equal(h.find('.ipa-palette').closest('.ipa-editor').querySelector('input').id,'word-1-ipa');
    await h.click('[data-action="settings"]');assert.equal(h.find('.ipa-palette'),null);await h.click('[data-dialog="cancel"]');if(h.find('.ipa-palette'))assert.equal(h.w.document.activeElement.id,'word-1-ipa');h.w.document.activeElement.blur();assert.equal(h.find('.ipa-palette'),null);
  }finally{await h.close();}
});
test('IPA persists through real D1, reload, JSON/ZIP transfers, and English-side bracketed cards in both directions',async()=>{
  const h=await harness('ja');
  try{
    assert.match(h.find('label[for="word-0-ipa"]').textContent,/発音記号/);h.input('#word-0-ipa',' [tiː] ');h.input('#word-1-ipa','/kæt/');await h.click('[data-action="save"]');await waitFor(()=>h.find('#word-0-ipa')?.value==='tiː','IPA saved and normalized');
    const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[0].ipa,'tiː');assert.equal(saved.words[1].ipa,'kæt');
    await h.click('[data-action="export-draft"]');const exported=JSON.parse(await h.downloads.at(-1).text());assert.equal(exported.words[0].ipa,'tiː');assert.deepEqual(core.parseImport(exported)[0].words,saved.words);
    await h.click('[data-action="import"]');const picker=h.find('#import-files'),bytes=zip.zipSync({'ipa.json':zip.strToU8(JSON.stringify(exported))});Object.defineProperty(picker,'files',{value:[{name:'ipa.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});await picker.onchange({target:picker});const details=h.find('[data-import-inspect]');details.open=true;details.dispatchEvent(new h.w.Event('toggle'));assert.match(details.textContent,/\[tiː\]/);await h.click('#import-confirm');await waitFor(()=>!h.find('#modal').open,'ZIP import');assert.equal(h.find('#word-1-ipa').value,'kæt');
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="reload"]');await waitFor(()=>h.find('.set-card'),'sets reloaded');await h.click('[data-action="open"][data-id="'+h.set.id+'"]');await h.click('[data-activity="cards"]');await h.click('[data-mode="en-ja"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-front .card-ipa').textContent,'[tiː]');assert.equal(h.find('.flashcard-back .card-ipa'),null);
    await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-front').getAttribute('aria-hidden'),'true');await h.click('[data-action="back-order"]');await h.click('[data-action="back-mode"]');await h.click('[data-mode="ja-en"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-front .card-ipa'),null);assert.equal(h.find('.flashcard-back').getAttribute('aria-hidden'),'true');assert.equal(h.find('.flashcard-back .card-ipa').textContent,'[tiː]');await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-back').getAttribute('aria-hidden'),'false');
  }finally{await h.close();}
});
