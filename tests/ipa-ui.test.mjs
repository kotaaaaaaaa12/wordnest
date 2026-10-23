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
function selection(h,input){
  const current=h.w.getSelection();if(!current.rangeCount)return [0,0];const range=current.getRangeAt(0),prefix=range.cloneRange();
  if(!input.contains(range.startContainer)||!input.contains(range.endContainer))return [0,0];
  prefix.selectNodeContents(input);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length;prefix.setEnd(range.endContainer,range.endOffset);return [start,prefix.toString().length];
}
function select(h,input,start,end=start){
  const point=offset=>{const walker=h.w.document.createTreeWalker(input,h.w.NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){if(offset<=node.textContent.length)return [node,offset];offset-=node.textContent.length;}return [input,input.childNodes.length];};
  const range=h.w.document.createRange();range.setStart(...point(start));range.setEnd(...point(end));const current=h.w.getSelection();current.removeAllRanges();current.addRange(range);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));
}
function typeText(h,input,text){
  const before=new h.w.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:text});input.dispatchEvent(before);if(before.defaultPrevented)return before;
  const selection=h.w.getSelection(),range=selection.getRangeAt(0);range.deleteContents();const node=h.w.document.createTextNode(text);range.insertNode(node);range.setStart(node,text.length);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
  input.dispatchEvent(new h.w.InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));return before;
}
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
  const find=s=>w.document.querySelector(s);async function click(s){const element=find(s);assert.ok(element,s);element.click();await tick();await tick();}function input(s,value){const element=find(s);if(element.matches('[data-field="ipa"]')){element.textContent=value;if(w.document.activeElement===element)select({w},element,value.length);}else element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));}
  w.eval(source);await waitFor(()=>find('[data-action="edit-set"]'),'editor loaded');await click('[data-action="edit-set"]');return {w,mf,set,find,click,input,request,downloads,async close(){w.close();await mf.dispose();}};
}
test('IPA palette exists only for the focused input and inserts at the caret without stealing focus or losing selection',async()=>{
  const h=await harness();
  try{
    assert.equal(h.find('.ipa-palette'),null);h.find('#word-0-english').focus();assert.equal(h.find('.ipa-palette'),null);
    const input=h.find('#word-0-ipa');input.focus();assert.ok(h.find('#ipa-palette'));assert.equal(input.getAttribute('aria-controls'),'ipa-palette');h.input('#word-0-ipa','tiː');select(h,input,1,2);
    const symbol=h.find('[data-ipa-symbol="ə"]'),event=new h.w.MouseEvent('pointerdown',{bubbles:true,cancelable:true});symbol.dispatchEvent(event);assert.equal(event.defaultPrevented,true);await h.click('[data-ipa-symbol="ə"]');assert.equal(h.w.document.activeElement,input);assert.equal(input.textContent,'təː');assert.equal(selection(h,input)[0],2);assert.ok(h.find('.ipa-palette'));assert.equal(h.find('#dirty-label').textContent,messages.en.unsaved);
    select(h,input,0,0);await h.click('[data-ipa-symbol="ˈ"]');assert.equal(input.textContent,'ˈtəː');assert.equal(selection(h,input)[0],1);
    h.find('#word-0-meaning').focus();assert.equal(h.find('.ipa-palette'),null);assert.equal(input.hasAttribute('aria-controls'),false);h.find('#word-1-ipa').focus();assert.equal(h.w.document.querySelectorAll('.ipa-palette').length,1);assert.equal(h.find('.ipa-palette').closest('.ipa-editor').querySelector('[data-field="ipa"]').id,'word-1-ipa');
    await h.click('[data-action="settings"]');assert.equal(h.find('.ipa-palette'),null);await h.click('[data-dialog="cancel"]');if(h.find('.ipa-palette'))assert.equal(h.w.document.activeElement.id,'word-1-ipa');h.w.document.activeElement.blur();assert.equal(h.find('.ipa-palette'),null);
  }finally{await h.close();}
});
test('categorized palette covers English dictionary symbols, variants and combining marks without losing the input caret',async()=>{
  const h=await harness('ja');
  try{
    const input=h.find('#word-0-ipa');input.focus();h.input('#word-0-ipa','ab');select(h,input,1,1);const original=input;
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
      assert.equal(h.w.document.activeElement,original);assert.equal(selection(h,input)[0],1);assert.equal(input.textContent,'ab');assert.equal(h.find(selector).getAttribute('aria-pressed'),'true');assert.equal(h.find('.ipa-groups').textContent.includes('undefined'),false);
      const keys=[...h.w.document.querySelectorAll('.ipa-keys [data-ipa-symbol]')].map(button=>button.dataset.ipaSymbol);for(const symbol of symbols)assert.ok(keys.includes(symbol),group+' includes '+symbol);keys.forEach(symbol=>all.add(symbol));
    }
    assert.ok(all.size>=130);const accent=keyFor(h,'\u0301');assert.equal(accent.textContent,'◌́');accent.click();assert.equal(input.textContent,'áb');assert.equal(selection(h,input)[0],2);assert.equal(input.textContent.includes('◌'),false);
    keyFor(h,'oʊ').click();assert.equal(input.textContent,'áoʊb');assert.equal(selection(h,input)[0],4);
    await h.click('[data-action="save"]');await waitFor(()=>!h.find('#dirty-label').textContent,'palette symbols saved');const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[0].ipa,'áoʊb');
  }finally{await h.close();}
});
test('IPA persists through real D1, reload, JSON/ZIP transfers, and English-side bracketed cards in both directions',async()=>{
  const h=await harness('ja');
  try{
    assert.match(h.find('#word-0-ipa-label').textContent,/発音記号/);h.input('#word-0-ipa',' [tiː] ');h.input('#word-1-ipa','/kæt/');await h.click('[data-action="save"]');await waitFor(()=>h.find('#word-0-ipa')?.textContent==='tiː','IPA saved and normalized');
    const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[0].ipa,'tiː');assert.equal(saved.words[1].ipa,'kæt');
    await h.click('[data-action="export-draft"]');const exported=JSON.parse(await h.downloads.at(-1).text());assert.equal(exported.words[0].ipa,'tiː');assert.deepEqual(core.parseImport(exported)[0].words,saved.words);
    await h.click('[data-action="import"]');const picker=h.find('#import-files'),bytes=zip.zipSync({'ipa.json':zip.strToU8(JSON.stringify(exported))});Object.defineProperty(picker,'files',{value:[{name:'ipa.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});await picker.onchange({target:picker});const details=h.find('[data-import-inspect]');details.open=true;details.dispatchEvent(new h.w.Event('toggle'));assert.match(details.textContent,/\[tiː\]/);await h.click('#import-confirm');await waitFor(()=>!h.find('#modal').open,'ZIP import');assert.equal(h.find('#word-1-ipa').textContent,'kæt');
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="reload"]');await waitFor(()=>h.find('.set-card'),'sets reloaded');await h.click('[data-action="open"][data-id="'+h.set.id+'"]');await h.click('[data-activity="cards"]');await h.click('[data-mode="en-ja"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-front .card-ipa').textContent,'[tiː]');assert.equal(h.find('.flashcard-back .card-ipa'),null);
    await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-front').getAttribute('aria-hidden'),'true');await h.click('[data-action="back-order"]');await h.click('[data-action="back-mode"]');await h.click('[data-mode="ja-en"]');await h.click('[data-action="start-cards"]');assert.equal(h.find('.flashcard-front .card-ipa'),null);assert.equal(h.find('.flashcard-back').getAttribute('aria-hidden'),'true');assert.equal(h.find('.flashcard-back .card-ipa').textContent,'[tiː]');await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-back').getAttribute('aria-hidden'),'false');
  }finally{await h.close();}
});
test('short taps stay ordinary; holding and sliding inserts a combining accent once at the selection and saves it intact',async()=>{
  const h=await harness('ja');
  try{
    const input=h.find('#word-1-ipa');input.focus();const key=keyFor(h,'æ');let captured=null,releases=0;
    key.setPointerCapture=id=>{captured=id;};key.hasPointerCapture=id=>captured===id;key.releasePointerCapture=()=>{captured=null;releases++;};
    assert.equal(pointer(h,key,'pointerdown').defaultPrevented,true);assert.equal(h.find('.ipa-variants'),null);pointer(h,key,'pointerup');key.click();assert.equal(input.textContent,'æ');assert.equal(h.find('.ipa-variants'),null);
    h.input('#word-1-ipa','kæt');select(h,input,1,2);await hold(h,key);assert.equal(captured,1);assert.equal(key.getAttribute('aria-expanded'),'true');assert.equal(input.textContent,'kæt');
    const variant=variantFor(h,'æ\u0301');assert.ok(variant);assert.match(h.find('.ipa-variants').getAttribute('aria-label'),/æ/);h.w.document.elementFromPoint=(x,y)=>x===50&&y===80?variant:null;
    // Events remain retargeted to the held key even while the finger is over a candidate.
    pointer(h,key,'pointermove',50,80);assert.equal(variant.classList.contains('is-selected'),true);pointer(h,key,'pointerup',50,80);
    key.dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(input.textContent,'kæ\u0301t');assert.equal(selection(h,input)[0],3);assert.equal(h.w.document.activeElement,input);assert.equal(h.find('.ipa-variants'),null);assert.equal(key.getAttribute('aria-expanded'),'false');assert.equal(captured,null);assert.ok(releases>=2);
    await h.click('[data-action="save"]');await waitFor(()=>h.find('#word-1-ipa')?.textContent==='kæ\u0301t'&&!h.find('#dirty-label').textContent,'accent saved');
    const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[1].ipa,'kæ\u0301t');await h.click('[data-action="export-draft"]');const exported=JSON.parse(await h.downloads.at(-1).text());assert.equal(core.parseImport(exported)[0].words[1].ipa,'kæ\u0301t');
    await h.click('.nav [data-nav="home"]');await h.click('[data-action="open"][data-id="'+h.set.id+'"]');await h.click('[data-activity="cards"]');await h.click('[data-mode="ja-en"]');await h.click('[data-action="start-cards"]');await h.click('[data-action="next-card"]');await h.click('.flashcard-front .flashcard-text');assert.equal(h.find('.flashcard-back .card-ipa').textContent,'[kæ\u0301t]');
  }finally{await h.close();}
});
test('holding then releasing allows a separate candidate tap; vowels, desktop context menus and length limits work',async()=>{
  const h=await harness();
  try{
    const input=h.find('#word-0-ipa');input.focus();const key=keyFor(h,'æ');await hold(h,key);pointer(h,key,'pointerup');key.click();assert.equal(input.textContent,'');assert.ok(h.find('.ipa-variants'));
    const variant=variantFor(h,'æ\u0300');pointer(h,variant,'pointerdown');variant.click();assert.equal(input.textContent,'æ\u0300');assert.equal(h.w.document.activeElement,input);assert.equal(h.find('.ipa-variants'),null);
    for(const symbol of ['a','e','i','o','u','ə','ʌ','ɪ','ʊ']){
      const vowel=keyFor(h,symbol),menu=new h.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true});assert.equal(pointer(h,vowel,'pointerdown',120,220,{button:2,pointerType:'mouse'}).defaultPrevented,true);vowel.dispatchEvent(menu);assert.equal(menu.defaultPrevented,true);assert.equal(h.w.document.querySelectorAll('[data-ipa-variant]').length,8);
      variantFor(h,symbol+'\u0304').click();assert.ok(input.textContent.endsWith(symbol+'\u0304'));assert.equal(h.find('.ipa-variants'),null);
    }
    // Combining marks occupy storage characters too; never insert a partial symbol at the cap.
    h.input('#word-0-ipa','x'.repeat(199));select(h,input,199,199);key.dispatchEvent(new h.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));variantFor(h,'æ\u0301').click();assert.equal(input.textContent.length,199);assert.equal(h.find('.ipa-variants'),null);
    select(h,input,198,199);key.dispatchEvent(new h.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));variantFor(h,'æ\u0301').click();assert.equal(input.textContent.length,200);assert.ok(input.textContent.endsWith('æ\u0301'));
    const plain=keyFor(h,'θ');pointer(h,plain,'pointerdown');pointer(h,plain,'pointerup');assert.equal(h.find('.ipa-variants'),null);
  }finally{await h.close();}
});
test('movement, cancellation, focus loss, dialogs and interrupted pointers never insert a stale long-press character',async()=>{
  const h=await harness();
  try{
    let input=h.find('#word-0-ipa');input.focus();let key=keyFor(h,'æ');pointer(h,key,'pointerdown');pointer(h,key,'pointermove',150,280);key.click();await new Promise(resolve=>setTimeout(resolve,450));assert.equal(h.find('.ipa-variants'),null);assert.equal(input.textContent,'');
    pointer(h,key,'pointerdown');pointer(h,key,'pointercancel');key.click();await new Promise(resolve=>setTimeout(resolve,450));assert.equal(h.find('.ipa-variants'),null);assert.equal(input.textContent,'');
    for(const interrupt of ['pointercancel','lostpointercapture','multitouch','scroll','Escape','outside']){
      await hold(h,key);
      if(interrupt==='multitouch')pointer(h,key,'pointerdown',120,220,{pointerId:2,isPrimary:false});
      else if(interrupt==='scroll')h.w.document.dispatchEvent(new h.w.Event('scroll'));
      else if(interrupt==='Escape')input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      else if(interrupt==='outside')pointer(h,h.w.document.body,'pointerdown',400,400);
      else pointer(h,key,interrupt);
      assert.equal(h.find('.ipa-variants'),null,interrupt);pointer(h,key,'pointerup');key.click();assert.equal(input.textContent,'',interrupt);
    }
    await hold(h,key);h.find('#word-0-meaning').focus();assert.equal(h.find('.ipa-variants'),null);assert.equal(h.find('.ipa-palette'),null);assert.equal(input.textContent,'');
    input.focus();key=keyFor(h,'æ');await hold(h,key);await h.click('[data-action="settings"]');assert.equal(h.find('.ipa-variants'),null);assert.equal(h.find('.ipa-palette'),null);await h.click('[data-dialog="cancel"]');
    input=h.find('#word-0-ipa');input.focus();key=keyFor(h,'æ');await hold(h,key);h.w.dispatchEvent(new h.w.Event('blur'));assert.equal(h.find('.ipa-variants'),null);assert.equal(input.textContent,'');
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
    select(h,input,7,8);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));assert.equal(button.disabled,false);assert.equal(pointer(h,button,'pointerdown').defaultPrevented,true);button.click();assert.equal(input.textContent,'əkwéintəns');assert.equal(h.w.document.activeElement,input);assert.equal(selection(h,input)[0],7);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(preview.querySelectorAll('i').length,1);assert.equal(preview.querySelector('i').textContent,'ə');assert.equal(h.w.getComputedStyle(preview.querySelector('i')).fontStyle,'italic');
    button.click();assert.equal(preview.querySelector('i'),null);assert.equal(button.getAttribute('aria-pressed'),'false');
    h.input('#word-0-ipa','');h.input('#word-0-ipa','kǽt');select(h,input,2,3);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));button.click();assert.equal(preview.querySelector('i').textContent,'ǽ');assert.deepEqual([selection(h,input)[0],selection(h,input)[1]],[1,3]);
    input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(preview.querySelector('i'),null);input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}));assert.equal(preview.querySelector('i').textContent,'ǽ');
    input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'i',metaKey:true,bubbles:true,cancelable:true}));assert.equal(preview.querySelector('i'),null);
    select(h,input,1,3);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));button.click();select(h,input,0,0);input.dispatchEvent(new h.w.InputEvent('beforeinput',{inputType:'insertText',data:'X',bubbles:true,cancelable:true}));h.input('#word-0-ipa','Xkǽt');assert.equal(preview.querySelector('i').textContent,'ǽ');assert.equal(preview.textContent,'[Xkǽt]');
    const undo=new h.w.InputEvent('beforeinput',{inputType:'historyUndo',bubbles:true,cancelable:true});input.dispatchEvent(undo);assert.equal(undo.defaultPrevented,true);assert.equal(input.textContent,'kǽt');assert.equal(preview.querySelector('i').textContent,'ǽ');
    h.input('#word-0-ipa','');h.input('#word-0-ipa','<img src=x onerror=alert(1)>');select(h,input,0,input.textContent.length);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));button.click();assert.equal(preview.querySelector('img'),null);assert.equal(preview.querySelector('i').textContent,'<img src=x onerror=alert(1)>');
  }finally{await h.close();}
});
test('per-character IPA formatting persists in D1 and JSON/ZIP, appears in import previews and in both English card faces',async()=>{
  const h=await harness();
  try{
    h.input('#word-0-ipa',' [əkwéintəns] ');h.input('#word-1-ipa','kǽt');
    for(const [index,start,end] of [[0,9,10],[1,1,3]]){const input=h.find('#word-'+index+'-ipa');input.focus();select(h,input,start,end);input.dispatchEvent(new h.w.Event('select',{bubbles:true}));await h.click('.ipa-editor:has(#word-'+index+'-ipa) [data-action="ipa-italic"]');}
    await h.click('[data-action="save"]');await waitFor(()=>h.find('#word-0-ipa')?.textContent==='əkwéintəns'&&!h.find('#dirty-label').textContent,'format saved');
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
test('palette italic input stays enabled, styles keys and long-press variants, and saves the visible rich field',async()=>{
  const h=await harness('ja');
  try{
    const style=h.w.document.createElement('style');style.textContent=await readFile('public/styles.css','utf8');h.w.document.head.append(style);
    let input=h.find('#word-0-ipa');input.focus();assert.equal(input.getAttribute('contenteditable'),'true');assert.equal(input.getAttribute('role'),'textbox');assert.equal(h.find('[data-action="ipa-shift"]').getAttribute('aria-pressed'),'false');
    const shift=h.find('[data-action="ipa-shift"]');assert.equal(pointer(h,shift,'pointerdown').defaultPrevented,true);await h.click('[data-action="ipa-shift"]');assert.equal(h.find('#dirty-label').textContent,'');assert.equal(h.w.document.activeElement,input);assert.equal(h.w.getComputedStyle(h.find('.ipa-symbol')).fontStyle,'italic');
    keyFor(h,'ə').click();keyFor(h,'æ').click();keyFor(h,'θ').click();assert.equal(input.textContent,'əæθ');assert.equal(input.querySelector('i').textContent,'əæθ');assert.equal(h.find('[data-action="ipa-shift"]').getAttribute('aria-pressed'),'true');
    await h.click('[data-action="ipa-shift"]');keyFor(h,'a').click();assert.equal(input.textContent,'əæθa');assert.equal(input.querySelector('i').textContent,'əæθ');assert.equal(h.w.getComputedStyle(h.find('.ipa-symbol')).fontStyle,'normal');
    await h.click('[data-action="ipa-shift"]');const key=keyFor(h,'æ');await hold(h,key);assert.equal(h.w.getComputedStyle(h.find('.ipa-variants button')).fontStyle,'italic');pointer(h,key,'pointerup');key.click();variantFor(h,'ǽ').click();assert.equal(input.textContent,'əæθaǽ');assert.deepEqual([...input.querySelectorAll('i')].map(i=>i.textContent),['əæθ','ǽ']);assert.deepEqual(selection(h,input),[6,6]);
    await h.click('[data-action="save"]');await waitFor(()=>!h.find('#dirty-label').textContent,'rich IPA saved');input=h.find('#word-0-ipa');assert.equal(input.textContent,'əæθaǽ');assert.deepEqual([...input.querySelectorAll('i')].map(i=>i.textContent),['əæθ','ǽ']);assert.equal(h.find('[data-action="ipa-shift"]').getAttribute('aria-pressed'),'true');
    const saved=(await(await h.request('/api/sets')).json()).sets[0];assert.equal(saved.words[0].ipa,'əæθaǽ');assert.deepEqual(saved.words[0].ipaItalic,[[0,3],[4,6]]);
  }finally{await h.close();}
});
test('rich-field native ranges, keyboard edits and selection formatting retain precise caret positions and per-field input modes',async()=>{
  const h=await harness();
  try{
    let input=h.find('#word-0-ipa');await h.click('#word-0-ipa-label');assert.equal(h.w.document.activeElement,input);select(h,input,0);typeText(h,input,'ab');select(h,input,1);await h.click('[data-action="ipa-shift"]');typeText(h,input,'ə');assert.equal(input.textContent,'aəb');assert.equal(input.querySelector('i').textContent,'ə');assert.deepEqual(selection(h,input),[2,2]);
    h.find('#word-1-ipa').focus();assert.equal(h.find('[data-action="ipa-shift"]').getAttribute('aria-pressed'),'false');keyFor(h,'æ').click();assert.equal(h.find('#word-1-ipa').querySelector('i'),null);input.focus();assert.equal(h.find('[data-action="ipa-shift"]').getAttribute('aria-pressed'),'true');
    select(h,input,1,2);await h.click('[data-action="ipa-shift"]');assert.deepEqual(selection(h,input),[1,2]);typeText(h,input,'XY');assert.equal(input.textContent,'aXYb');assert.equal(input.querySelector('i'),null);assert.deepEqual(selection(h,input),[3,3]);
    select(h,input,1,3);input.dispatchEvent(new h.w.Event('selectionchange',{bubbles:true}));await h.click('.ipa-editor:has(#word-0-ipa) [data-action="ipa-italic"]');assert.equal(input.querySelector('i').textContent,'XY');assert.deepEqual(selection(h,input),[1,3]);
    await h.click('[data-action="settings"]');assert.equal(h.find('.ipa-palette'),null);await h.click('[data-dialog="cancel"]');assert.equal(h.w.document.activeElement,input);assert.deepEqual(selection(h,input),[1,3]);
    input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(input.querySelector('i'),null);input.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));assert.equal(input.querySelector('i').textContent,'XY');
    await h.click('[data-action="ipa-shift"]');select(h,input,1,3);await h.click('[data-action="settings"]');const language=h.find('#settings-language');language.value='ja';language.dispatchEvent(new h.w.Event('change',{bubbles:true}));await tick();await h.click('[data-dialog="cancel"]');input=h.find('#word-0-ipa');assert.equal(h.w.document.activeElement,input);assert.deepEqual(selection(h,input),[1,3]);assert.equal(input.querySelector('i').textContent,'XY');assert.equal(h.find('[data-action="ipa-shift"]').getAttribute('aria-pressed'),'true');
  }finally{await h.close();}
});
test('rich IPA handles composition, single-line paste, HTML safety and grapheme-aware length limits',async()=>{
  const h=await harness();
  try{
    const input=h.find('#word-0-ipa');input.focus();select(h,input,0);await h.click('[data-action="ipa-shift"]');input.dispatchEvent(new h.w.CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new h.w.InputEvent('beforeinput',{inputType:'insertCompositionText',data:'æ',isComposing:true,bubbles:true}));
    const node=h.w.document.createTextNode('æ');input.replaceChildren(node);select(h,input,1);input.dispatchEvent(new h.w.InputEvent('input',{inputType:'insertCompositionText',data:'æ',isComposing:true,bubbles:true}));assert.equal(input.firstChild,node,'composition keeps the native editing DOM');input.dispatchEvent(new h.w.CompositionEvent('compositionend',{bubbles:true,data:'æ'}));await waitFor(()=>input.querySelector('i'),'committed composition painted');assert.equal(input.querySelector('i').textContent,'æ');assert.deepEqual(selection(h,input),[1,1]);
    const paste=new h.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/plain'?'<b>ə</b>\ntext':'<img src=x onerror=alert(1)>'}});input.dispatchEvent(paste);assert.equal(paste.defaultPrevented,true);assert.equal(input.textContent,'æ<b>ə</b> text');assert.equal(input.querySelector('b'),null);assert.equal(input.querySelector('img'),null);assert.equal(input.querySelector('i').textContent,'æ<b>ə</b> text');
    const enter=new h.w.InputEvent('beforeinput',{inputType:'insertParagraph',bubbles:true,cancelable:true});input.dispatchEvent(enter);assert.equal(enter.defaultPrevented,true);assert.equal(input.querySelector('div'),null);
    h.input('#word-0-ipa','x'.repeat(199));select(h,input,199);assert.equal(typeText(h,input,'xx').defaultPrevented,true);assert.equal(input.textContent.length,199);
    const fullPaste=new h.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(fullPaste,'clipboardData',{value:{getData:()=> 'ǽ'}});input.dispatchEvent(fullPaste);assert.equal(input.textContent,'x'.repeat(199),'no partial accent is pasted');
    select(h,input,0,199);const emptyPaste=new h.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(emptyPaste,'clipboardData',{value:{getData:()=>''}});input.dispatchEvent(emptyPaste);assert.equal(input.textContent.length,199,'an image or empty clipboard does not delete selected text');
  }finally{await h.close();}
});
