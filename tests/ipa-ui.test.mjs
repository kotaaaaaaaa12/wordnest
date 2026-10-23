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
function pointer(h,target,type,x=120,y=220,extra={}){
  const event=new h.w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});
  Object.defineProperties(event,Object.fromEntries(Object.entries({pointerId:1,isPrimary:true,pointerType:'touch',...extra}).map(([key,value])=>[key,{value}])));target.dispatchEvent(event);return event;
}
function keyFor(h,symbol){
  const find=()=>[...h.w.document.querySelectorAll('.ipa-palette [data-ipa-symbol]')].find(button=>button.dataset.ipaSymbol===symbol);
  let key=find();if(!key)for(const group of [...h.w.document.querySelectorAll('[data-ipa-group]')].map(tab=>tab.dataset.ipaGroup)){h.find('[data-ipa-group="'+group+'"]').click();key=find();if(key)break;}
  assert.ok(key,'palette key '+symbol);
  key.getBoundingClientRect=()=>({left:100,top:200,right:140,bottom:240,width:40,height:40});return key;
}
async function hold(h,key){pointer(h,key,'pointerdown');await waitFor(()=>h.find('.ipa-variants'),'long-press alternatives');}
function variantFor(h,symbol){return [...h.w.document.querySelectorAll('[data-ipa-variant]')].find(button=>button.dataset.ipaSymbol===symbol);}
async function harness(lang='en',viewportConfig){
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'ipa-testing-password'}}));
  const response=await mf.dispatchFetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'ipa-testing-password'})}),cookie=response.headers.get('set-cookie').split(';')[0];
  const request=(path,options={})=>mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,Cookie:cookie}});
  const initial={title:'Legacy words',words:[{english:'tea',meaning:'お茶',explanation:''},{english:'cat',meaning:'猫',explanation:''}]};
  const set=(await(await request('/api/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(initial)})).json()).sets[0];
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:origin+'/#/edit',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,downloads=[];
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  if(viewportConfig){const viewport=new w.EventTarget();Object.assign(viewport,viewportConfig);Object.defineProperty(w,'visualViewport',{value:viewport});}
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
test('categorized palette covers English dictionary symbols, variants and combining marks without losing the input caret',async()=>{
  const h=await harness('ja');
  try{
    const input=h.find('#word-0-ipa');input.focus();h.input('#word-0-ipa','ab');input.setSelectionRange(1,1);const original=input;
    const expected={
      vowels:['i','ɪ','e','ɛ','æ','ɑ','ɒ','ɔ','ʊ','u','ʌ','ə','ɜ','ɚ','ɝ','ɘ','ɐ','ɨ','ʉ','ɵ','ɞ'],
      consonants:['p','b','t','d','k','ɡ','tʃ','dʒ','f','v','θ','ð','s','z','ʃ','ʒ','h','m','n','ŋ','l','r','ɹ','j','w'],
      combinations:['iː','ɑː','ɔː','uː','ɜː','eɪ','əʊ','oʊ','aɪ','ɔɪ','aʊ','ɪə','eə','ʊə','ɛə'],
      details:['ɾ','ʔ','ɫ','ʍ','x','ç','n̩','l̩','m̩','ʰ','ᵊ','ʧ','ʤ','t͡ʃ','d͡ʒ'],
      marks:['ˈ','ˌ','ː','ˑ','.','\u0301','\u0329','\u032f','\u0325','\u032c','\u031a','\u0303'],
    };
    const all=new Set();
    for(const [group,symbols] of Object.entries(expected)){
      const selector='[data-ipa-group="'+group+'"]',tab=h.find(selector);assert.equal(pointer(h,tab,'pointerdown').defaultPrevented,true);await h.click(selector);
      assert.equal(h.w.document.activeElement,original);assert.equal(input.selectionStart,1);assert.equal(input.value,'ab');assert.equal(h.find(selector).getAttribute('aria-pressed'),'true');assert.equal(h.find('.ipa-groups').textContent.includes('undefined'),false);
      const keys=[...h.w.document.querySelectorAll('.ipa-keys [data-ipa-symbol]')].map(button=>button.dataset.ipaSymbol);for(const symbol of symbols)assert.ok(keys.includes(symbol),group+' includes '+symbol);keys.forEach(symbol=>all.add(symbol));
    }
    assert.ok(all.size>=130);const accent=keyFor(h,'\u0301');assert.equal(accent.textContent,'◌́');accent.click();assert.equal(input.value,'áb');assert.equal(input.selectionStart,2);assert.equal(input.value.includes('◌'),false);
    keyFor(h,'oʊ').click();assert.equal(input.value,'áoʊb');assert.equal(input.selectionStart,4);
    await h.click('[data-action="save"]');await waitFor(()=>!h.find('#dirty-label').textContent,'palette symbols saved');const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[0].ipa,'áoʊb');
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
test('short taps stay ordinary; holding and sliding inserts a combining accent once at the selection and saves it intact',async()=>{
  const h=await harness('ja');
  try{
    const input=h.find('#word-1-ipa');input.focus();const key=keyFor(h,'æ');let captured=null,releases=0;
    key.setPointerCapture=id=>{captured=id;};key.hasPointerCapture=id=>captured===id;key.releasePointerCapture=()=>{captured=null;releases++;};
    assert.equal(pointer(h,key,'pointerdown').defaultPrevented,true);assert.equal(h.find('.ipa-variants'),null);pointer(h,key,'pointerup');key.click();assert.equal(input.value,'æ');assert.equal(h.find('.ipa-variants'),null);
    h.input('#word-1-ipa','kæt');input.setSelectionRange(1,2);await hold(h,key);assert.equal(captured,1);assert.equal(key.getAttribute('aria-expanded'),'true');assert.equal(input.value,'kæt');
    const variant=variantFor(h,'æ\u0301');assert.ok(variant);assert.match(h.find('.ipa-variants').getAttribute('aria-label'),/æ/);h.w.document.elementFromPoint=(x,y)=>x===50&&y===80?variant:null;
    // Events remain retargeted to the held key even while the finger is over a candidate.
    pointer(h,key,'pointermove',50,80);assert.equal(variant.classList.contains('is-selected'),true);pointer(h,key,'pointerup',50,80);
    key.dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(input.value,'kæ\u0301t');assert.equal(input.selectionStart,3);assert.equal(h.w.document.activeElement,input);assert.equal(h.find('.ipa-variants'),null);assert.equal(key.getAttribute('aria-expanded'),'false');assert.equal(captured,null);assert.ok(releases>=2);
    await h.click('[data-action="save"]');await waitFor(()=>h.find('#word-1-ipa')?.value==='kæ\u0301t'&&!h.find('#dirty-label').textContent,'accent saved');
    const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[1].ipa,'kæ\u0301t');await h.click('[data-action="export-draft"]');const exported=JSON.parse(await h.downloads.at(-1).text());assert.equal(core.parseImport(exported)[0].words[1].ipa,'kæ\u0301t');
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="open"][data-id="'+h.set.id+'"]');await h.click('[data-activity="cards"]');await h.click('[data-mode="ja-en"]');await h.click('[data-action="start-cards"]');await h.click('[data-action="next-card"]');await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-back .card-ipa').textContent,'[kæ\u0301t]');
  }finally{await h.close();}
});
test('holding then releasing allows a separate candidate tap; vowels, desktop context menus and length limits work',async()=>{
  const h=await harness();
  try{
    const input=h.find('#word-0-ipa');input.focus();const key=keyFor(h,'æ');await hold(h,key);pointer(h,key,'pointerup');key.click();assert.equal(input.value,'');assert.ok(h.find('.ipa-variants'));
    const variant=variantFor(h,'æ\u0300');pointer(h,variant,'pointerdown');variant.click();assert.equal(input.value,'æ\u0300');assert.equal(h.w.document.activeElement,input);assert.equal(h.find('.ipa-variants'),null);
    for(const symbol of ['a','e','i','o','u','ə','ʌ','ɪ','ʊ']){
      const vowel=keyFor(h,symbol),menu=new h.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true});assert.equal(pointer(h,vowel,'pointerdown',120,220,{button:2,pointerType:'mouse'}).defaultPrevented,true);vowel.dispatchEvent(menu);assert.equal(menu.defaultPrevented,true);assert.equal(h.w.document.querySelectorAll('[data-ipa-variant]').length,8);
      variantFor(h,symbol+'\u0304').click();assert.ok(input.value.endsWith(symbol+'\u0304'));assert.equal(h.find('.ipa-variants'),null);
    }
    // Combining marks occupy storage characters too; never insert a partial symbol at the cap.
    h.input('#word-0-ipa','x'.repeat(199));input.setSelectionRange(199,199);key.dispatchEvent(new h.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));variantFor(h,'æ\u0301').click();assert.equal(input.value.length,199);assert.equal(h.find('.ipa-variants'),null);
    input.setSelectionRange(198,199);key.dispatchEvent(new h.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));variantFor(h,'æ\u0301').click();assert.equal(input.value.length,200);assert.ok(input.value.endsWith('æ\u0301'));
    const plain=keyFor(h,'θ');pointer(h,plain,'pointerdown');pointer(h,plain,'pointerup');assert.equal(h.find('.ipa-variants'),null);
  }finally{await h.close();}
});
test('movement, cancellation, focus loss, dialogs and interrupted pointers never insert a stale long-press character',async()=>{
  const h=await harness();
  try{
    let input=h.find('#word-0-ipa');input.focus();let key=keyFor(h,'æ');pointer(h,key,'pointerdown');pointer(h,key,'pointermove',150,280);key.click();await new Promise(resolve=>setTimeout(resolve,450));assert.equal(h.find('.ipa-variants'),null);assert.equal(input.value,'');
    pointer(h,key,'pointerdown');pointer(h,key,'pointercancel');key.click();await new Promise(resolve=>setTimeout(resolve,450));assert.equal(h.find('.ipa-variants'),null);assert.equal(input.value,'');
    for(const interrupt of ['pointercancel','lostpointercapture','multitouch','scroll','Escape','outside']){
      await hold(h,key);
      if(interrupt==='multitouch')pointer(h,key,'pointerdown',120,220,{pointerId:2,isPrimary:false});
      else if(interrupt==='scroll')h.w.document.dispatchEvent(new h.w.Event('scroll'));
      else if(interrupt==='Escape')input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      else if(interrupt==='outside')pointer(h,h.w.document.body,'pointerdown',400,400);
      else pointer(h,key,interrupt);
      assert.equal(h.find('.ipa-variants'),null,interrupt);pointer(h,key,'pointerup');key.click();assert.equal(input.value,'',interrupt);
    }
    await hold(h,key);h.find('#word-0-meaning').focus();assert.equal(h.find('.ipa-variants'),null);assert.equal(h.find('.ipa-palette'),null);assert.equal(input.value,'');
    input.focus();key=keyFor(h,'æ');await hold(h,key);await h.click('[data-action="settings"]');assert.equal(h.find('.ipa-variants'),null);assert.equal(h.find('.ipa-palette'),null);await h.click('[data-dialog="cancel"]');
    input=h.find('#word-0-ipa');input.focus();key=keyFor(h,'æ');await hold(h,key);h.w.dispatchEvent(new h.w.Event('blur'));assert.equal(h.find('.ipa-variants'),null);assert.equal(input.value,'');
  }finally{await h.close();}
});
test('accent candidates stay inside the visual viewport above the keyboard and close on viewport changes',async()=>{
  const h=await harness('en',{offsetLeft:30,offsetTop:60,width:320,height:220});
  try{
    const input=h.find('#word-0-ipa');input.focus();const key=keyFor(h,'u');key.getBoundingClientRect=()=>({left:330,top:260,right:370,bottom:300,width:40,height:40});await hold(h,key);
    const popup=h.find('.ipa-variants'),left=parseFloat(popup.style.left),top=parseFloat(popup.style.top),width=parseFloat(popup.style.width);assert.ok(left>=38);assert.ok(left+width<=342);assert.ok(top>=68);assert.ok(top+62<=272);
    h.w.visualViewport.dispatchEvent(new h.w.Event('resize'));assert.equal(h.find('.ipa-variants'),null);assert.equal(h.w.document.activeElement,input);
    await hold(h,key);h.w.visualViewport.dispatchEvent(new h.w.Event('scroll'));assert.equal(h.find('.ipa-variants'),null);
    await hold(h,key);h.w.dispatchEvent(new h.w.Event('resize'));assert.equal(h.find('.ipa-variants'),null);
  }finally{await h.close();}
});
test('individual IPA characters toggle italics with a normal default, whole combining characters, undo/redo and escaped previews',async()=>{
  const h=await harness('ja');
  try{
    const css=h.w.document.createElement('style');css.textContent=await readFile('public/styles.css','utf8');h.w.document.head.append(css);
    const input=h.find('#word-0-ipa'),preview=h.find('.ipa-preview-value'),button=h.find('[data-action="ipa-italic"]');input.focus();h.input('#word-0-ipa','əkwéintəns');assert.equal(preview.textContent,'[əkwéintəns]');assert.equal(preview.querySelector('i'),null);assert.equal(h.w.getComputedStyle(preview).fontStyle,'normal');
    input.setSelectionRange(7,8);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));assert.equal(button.disabled,false);assert.equal(pointer(h,button,'pointerdown').defaultPrevented,true);button.click();assert.equal(input.value,'əkwéintəns');assert.equal(h.w.document.activeElement,input);assert.equal(input.selectionStart,7);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(preview.querySelectorAll('i').length,1);assert.equal(preview.querySelector('i').textContent,'ə');assert.equal(h.w.getComputedStyle(preview.querySelector('i')).fontStyle,'italic');
    button.click();assert.equal(preview.querySelector('i'),null);assert.equal(button.getAttribute('aria-pressed'),'false');
    h.input('#word-0-ipa','');h.input('#word-0-ipa','kǽt');input.setSelectionRange(2,3);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));button.click();assert.equal(preview.querySelector('i').textContent,'ǽ');assert.deepEqual([input.selectionStart,input.selectionEnd],[1,3]);
    input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(preview.querySelector('i'),null);input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}));assert.equal(preview.querySelector('i').textContent,'ǽ');
    input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'i',metaKey:true,bubbles:true,cancelable:true}));assert.equal(preview.querySelector('i'),null);
    input.setSelectionRange(1,3);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));button.click();input.setSelectionRange(0,0);input.dispatchEvent(new h.w.InputEvent('beforeinput',{inputType:'insertText',data:'X',bubbles:true,cancelable:true}));h.input('#word-0-ipa','Xkǽt');assert.equal(preview.querySelector('i').textContent,'ǽ');assert.equal(preview.textContent,'[Xkǽt]');
    const undo=new h.w.InputEvent('beforeinput',{inputType:'historyUndo',bubbles:true,cancelable:true});input.dispatchEvent(undo);assert.equal(undo.defaultPrevented,true);assert.equal(input.value,'kǽt');assert.equal(preview.querySelector('i').textContent,'ǽ');
    h.input('#word-0-ipa','');h.input('#word-0-ipa','<img src=x onerror=alert(1)>');input.setSelectionRange(0,input.value.length);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));button.click();assert.equal(preview.querySelector('img'),null);assert.equal(preview.querySelector('i').textContent,'<img src=x onerror=alert(1)>');
  }finally{await h.close();}
});
test('per-character IPA formatting persists in D1 and JSON/ZIP, appears in import previews and in both English card faces',async()=>{
  const h=await harness();
  try{
    h.input('#word-0-ipa',' [əkwéintəns] ');h.input('#word-1-ipa','kǽt');
    for(const [index,start,end] of [[0,9,10],[1,1,3]]){const input=h.find('#word-'+index+'-ipa');input.focus();input.setSelectionRange(start,end);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));await h.click('.ipa-editor:has(#word-'+index+'-ipa) [data-action="ipa-italic"]');}
    await h.click('[data-action="save"]');await waitFor(()=>h.find('#word-0-ipa')?.value==='əkwéintəns'&&!h.find('#dirty-label').textContent,'format saved');
    const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.deepEqual(saved.words[0].ipaItalic,[[7,8]]);assert.deepEqual(saved.words[1].ipaItalic,[[1,3]]);
    await h.click('[data-action="export-draft"]');const exported=JSON.parse(await h.downloads.at(-1).text());assert.deepEqual(exported.words,saved.words);
    await h.click('[data-action="import"]');const picker=h.find('#import-files'),bytes=zip.zipSync({'formatted.json':zip.strToU8(JSON.stringify(exported))});Object.defineProperty(picker,'files',{value:[{name:'formatted.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});await picker.onchange({target:picker});const details=h.find('[data-import-inspect]');details.open=true;details.dispatchEvent(new h.w.Event('toggle'));assert.equal(details.querySelector('.import-ipa i').textContent,'ə');await h.click('#import-confirm');await waitFor(()=>!h.find('#modal').open,'format imported');
    const copies=(await(await h.request('/api/sets')).json()).sets;assert.equal(copies.length,2);for(const set of copies)assert.deepEqual(set.words,saved.words);
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="open"][data-id="'+h.set.id+'"]');await h.click('[data-activity="cards"]');await h.click('[data-mode="en-ja"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-front .card-ipa').textContent,'[əkwéintəns]');assert.equal(h.find('.flashcard-front .card-ipa i').textContent,'ə');assert.equal(h.find('.flashcard-front .card-ipa').childNodes[0].textContent,'[əkwéint');
    await h.click('[data-action="back-order"]');await h.click('[data-action="back-mode"]');await h.click('[data-mode="ja-en"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-front .card-ipa'),null);await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-back .card-ipa i').textContent,'ə');
  }finally{await h.close();}
});
test('D1 rejects malformed pronunciation text and formatting as validation errors without changing saved sets',async()=>{
  const h=await harness();
  try{
    for(const fields of [{ipa:'abc',ipaItalic:[[0,9]]},{ipa:'abc',ipaItalic:'<i>'},{ipa:'abc',ipaItalic:[[1,1]]},{ipa:'a\nb'}]){
      const response=await h.request('/api/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Invalid',words:[{english:'word',meaning:'単語',...fields}]})});assert.equal(response.status,400);assert.match((await response.json()).error,/^invalidIpa(?:Style)?$/);
    }
    const sets=(await(await h.request('/api/sets')).json()).sets;assert.equal(sets.length,1);assert.equal(sets[0].words[0].ipa,undefined);
  }finally{await h.close();}
});
