import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
const boot=await readFile('public/theme.js','utf8'),css=await readFile('public/styles.css','utf8'),source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function create({dark=false,prefs={}}={}) {
  const dom=new JSDOM('<meta name="theme-color"><div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,listeners=[];
  const system={matches:dark,addEventListener(type,callback){if(type==='change')listeners.push(callback);}};
  Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>system});w.document.hasFocus=()=>true;
  w.Audio=class{play(){return Promise.resolve();}};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/sets'?{sets:[],orderRevision:0}:{authenticated:false,configured:true}});
  for(const [key,value] of Object.entries(prefs))w.localStorage.setItem(key,value);
  const style=w.document.createElement('style');style.textContent=css;w.document.head.append(style);
  return {w,system,listeners};
}
test('saved palettes apply before app startup, preserve both defaults, and reject invalid stored choices',()=>{
  const cases=[['light','default','#f6f5f0'],['light','ocean','#eef5fa'],['light','lavender','#f5f2fa'],['dark','default','#171d1a'],['dark','midnight','#111a27'],['dark','graphite','#1b1b1e']];
  for(const [mode,palette,background] of cases){
    const {w}=create({prefs:{'wordnest-theme':mode,[`wordnest-${mode}-palette`]:palette}});
    try{w.eval(boot);assert.equal(w.document.documentElement.dataset.theme,mode);assert.equal(w.document.documentElement.dataset.palette,palette);assert.equal(w.document.querySelector('meta[name="theme-color"]').content,background);assert.equal(w.getComputedStyle(w.document.documentElement).getPropertyValue('--paper'),background);}finally{w.close();}
  }
  const {w}=create({dark:true,prefs:{'wordnest-theme':'invalid','wordnest-dark-palette':'ocean'}});
  try{w.eval(boot);assert.equal(w.document.documentElement.dataset.theme,'dark');assert.equal(w.document.documentElement.dataset.palette,'default');}finally{w.close();}
});
test('settings save independent light/dark palettes, auto follows the system, and localized navigation keeps its new order',async()=>{
  const {w,system,listeners}=create(),find=s=>w.document.querySelector(s);
  async function click(selector){find(selector).click();await tick();await tick();}
  function select(selector,value){const picker=find(selector);picker.focus();picker.value=value;picker.dispatchEvent(new w.Event('change',{bubbles:true}));assert.notEqual(w.document.activeElement.tagName,'SELECT');}
  try{
    w.eval(boot);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();
    assert.deepEqual([...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.dataset.nav),['home','stats','rankings','guide','history']);
    await click('[data-action="settings"]');assert.equal(find('#light-palette').options.length,3);assert.equal(find('#dark-palette').options.length,3);
    select('#light-palette','ocean');assert.equal(w.document.documentElement.dataset.palette,'ocean');select('#dark-palette','midnight');assert.equal(w.document.documentElement.dataset.palette,'ocean');
    system.matches=true;listeners.forEach(callback=>callback({matches:true}));assert.equal(w.document.documentElement.dataset.theme,'dark');assert.equal(w.document.documentElement.dataset.palette,'midnight');assert.equal(find('meta[name="theme-color"]').content,'#111a27');
    select('#dark-palette','graphite');assert.equal(w.document.documentElement.dataset.palette,'graphite');select('#theme-choice','light');assert.equal(w.document.documentElement.dataset.palette,'ocean');select('#light-palette','lavender');assert.equal(w.document.documentElement.dataset.palette,'lavender');
    select('#settings-language','ja');assert.equal(find('#light-palette').selectedOptions[0].textContent,'ラベンダー');assert.equal(find('#dark-palette').selectedOptions[0].textContent,'グラファイト');
    select('#theme-choice','auto');assert.equal(w.document.documentElement.dataset.palette,'graphite');system.matches=false;listeners.forEach(callback=>callback({matches:false}));assert.equal(w.document.documentElement.dataset.palette,'lavender');
    assert.equal(w.localStorage.getItem('wordnest-light-palette'),'lavender');assert.equal(w.localStorage.getItem('wordnest-dark-palette'),'graphite');assert.equal(w.localStorage.getItem('wordnest-theme'),'auto');
    await click('[data-dialog="cancel"]');assert.deepEqual([...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.textContent.trim()),['学習','学習記録','ランキング','説明','更新履歴']);
    const reopened=create({dark:true,prefs:{'wordnest-theme':'auto','wordnest-light-palette':w.localStorage.getItem('wordnest-light-palette'),'wordnest-dark-palette':w.localStorage.getItem('wordnest-dark-palette')}}).w;
    try{reopened.eval(boot);assert.equal(reopened.document.documentElement.dataset.palette,'graphite');}finally{reopened.close();}
  }finally{w.close();}
});

function resolveToken(w,element,name,seen=new Set()) {
  assert.ok(!seen.has(name),`Circular theme token: ${name}`);seen.add(name);
  const value=w.getComputedStyle(element).getPropertyValue(name).trim();
  const alias=/^var\((--[\w-]+)\)$/.exec(value);
  return alias?resolveToken(w,element,alias[1],seen):value;
}
function luminance(hex){
  assert.match(hex,/^#[\da-f]{6}$/i);
  const [r,g,b]=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
}
function contrast(first,second){const a=luminance(first),b=luminance(second);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
function declaration(w,selector,name){
  for(const sheet of w.document.styleSheets)for(const rule of sheet.cssRules)if(rule.selectorText===selector)return rule.style.getPropertyValue(name);
  assert.fail(`Missing selector: ${selector}`);
}
test('Graphite selections match the gold brand accent across navigation and practice controls',async()=>{
  const {w}=create({prefs:{'wordnest-theme':'dark','wordnest-dark-palette':'graphite'}});
  try{
    w.eval(boot);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();const root=w.document.documentElement;
    assert.equal(resolveToken(w,root,'--selection-text'),resolveToken(w,root,'--accent'));
    assert.equal(resolveToken(w,root,'--selection-bg'),resolveToken(w,root,'--soft'));
    assert.notEqual(resolveToken(w,root,'--selection-text'),resolveToken(w,root,'--green'));
    assert.ok(contrast(resolveToken(w,root,'--selection-text'),resolveToken(w,root,'--selection-bg'))>=4.5);
    assert.ok(contrast(resolveToken(w,root,'--brand-ink'),resolveToken(w,root,'--accent'))>=4.5);
    for(const selector of ['.nav a.active','.count-btn.active','.set-list button.active','.order-grid .mode-card.active','.library-tabs button[aria-pressed="true"],.segmented button[aria-pressed="true"]']){
      assert.equal(declaration(w,selector,'background'),'var(--selection-bg)');assert.equal(declaration(w,selector,'color'),'var(--selection-text)');
    }
  }finally{w.close();}
});
test('completion books, badges, and Guide legend have distinct semantic colors with readable contrast in every palette',async()=>{
  const semantic={none:'none','en-ja':'en','ja-en':'ja',both:'both'},seen={light:null,dark:null};
  for(const [mode,palettes] of Object.entries({light:['default','ocean','lavender'],dark:['default','midnight','graphite']}))for(const palette of palettes){
    const sets=Object.keys(semantic).map(id=>({id,title:id,words:[{english:'apple',meaning:'りんご'}]}));
    const progress=Object.fromEntries(sets.map(set=>[set.id,{key:core.studyKey(set),scope:'all-first-pass','en-ja':['en-ja','both'].includes(set.id),'ja-en':['ja-en','both'].includes(set.id)}]));
    const {w}=create({prefs:{'wordnest-theme':mode,[`wordnest-${mode}-palette`]:palette,'wordnest-progress':JSON.stringify(progress)}});
    const original=w.fetch;w.fetch=async(path,options)=>path==='/api/sets'?{ok:true,status:200,json:async()=>({sets,orderRevision:0})}:original(path,options);
    try{
      w.eval(boot);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();const root=w.document.documentElement,colors=[];
      for(const [status,token] of Object.entries(semantic)){
        const article=w.document.querySelector(`[data-set-id="${status}"]`);assert.equal(article.dataset.studyStatus,status);
        const foreground=resolveToken(w,article,'--study-color'),background=resolveToken(w,article,'--study-bg');
        assert.equal(foreground,resolveToken(w,root,`--clear-${token}-text`));assert.equal(background,resolveToken(w,root,`--clear-${token}-bg`));
        assert.ok(contrast(foreground,background)>=4.5,`${mode}/${palette}/${status} text contrast`);colors.push(foreground);
        assert.ok(article.querySelector('.set-symbol svg'));assert.ok(article.querySelector('.study-status').textContent.length);
        if(status!=='none')assert.ok(article.querySelector('.study-status svg'));
      }
      assert.equal(new Set(colors).size,4);if(seen[mode])assert.deepEqual(colors,seen[mode]);else seen[mode]=colors;
      w.document.querySelector('.nav [data-nav="guide"]').click();await tick();await tick();
      for(const status of Object.keys(semantic)){
        const legend=w.document.querySelector(`.guide-legend .study-${status}`);assert.equal(resolveToken(w,legend,'--study-color'),resolveToken(w,root,`--clear-${semantic[status]}-text`));
      }
    }finally{w.close();}
  }
});
test('modal backgrounds stay neutral and the active palette persists through modal switches and closing',async()=>{
  for(const [mode,palettes] of Object.entries({light:['default','ocean','lavender'],dark:['default','midnight','graphite']}))for(const palette of palettes){
    const {w}=create({prefs:{'wordnest-theme':mode,[`wordnest-${mode}-palette`]:palette}}),find=s=>w.document.querySelector(s);
    async function click(s){find(s).click();await tick();await tick();}
    try{
      w.eval(boot);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await tick();await tick();const root=w.document.documentElement;
      const expected=resolveToken(w,root,'--paper');await click('[data-action="settings"]');assert.equal(find('#modal').open,true);
      assert.equal(resolveToken(w,root,'--paper'),expected);assert.equal(root.dataset.palette,palette);
      const overlay=declaration(w,'dialog::backdrop','background');assert.equal(overlay,'rgba(0, 0, 0, 0.32)');assert.ok(!overlay.includes('var('));assert.equal(declaration(w,':root[data-theme="dark"] dialog::backdrop','background'),'rgba(0, 0, 0, 0.52)');
      assert.match(css,/dialog::backdrop\{[^}]*-webkit-backdrop-filter:blur\(4px\)/);assert.equal(declaration(w,'dialog::backdrop','backdrop-filter'),'blur(4px)');
      assert.equal(declaration(w,'body','background'),'var(--paper)');assert.equal(declaration(w,'.app-shell','background'),'var(--paper)');
      await click('[data-delete-learning="all"]');assert.equal(resolveToken(w,root,'--paper'),expected);assert.equal(root.dataset.palette,palette);
      await click('[data-dialog="cancel"]');assert.ok(find('#admin-controls'));await click('[data-dialog="cancel"]');assert.equal(find('#modal').open,false);assert.equal(root.dataset.palette,palette);
      await click('[data-action="settings"]');const picker=find(`#${mode}-palette`);picker.value=palette==='default'?palettes[1]:'default';picker.dispatchEvent(new w.Event('change',{bubbles:true}));
      const updated=resolveToken(w,root,'--paper');assert.notEqual(updated,expected);await click('[data-dialog="cancel"]');assert.equal(resolveToken(w,root,'--paper'),updated);
    }finally{w.close();}
  }
});
test('flashcard backs have a subtle accent overlay with readable ink in all six palettes; only IPA candidates use solid accents',()=>{
  for(const [mode,palettes] of Object.entries({light:['default','ocean','lavender'],dark:['default','midnight','graphite']}))for(const palette of palettes){
    const {w}=create({prefs:{'wordnest-theme':mode,[`wordnest-${mode}-palette`]:palette}});
    try{
      w.eval(boot);const root=w.document.documentElement,accent=resolveToken(w,root,'--accent'),surface=resolveToken(w,root,'--surface'),ink=resolveToken(w,root,'--ink');
      assert.equal(declaration(w,'.flashcard-back','background'),'var(--card-back-bg)');assert.equal(resolveToken(w,root,'--card-back-bg'),'color-mix(in srgb,var(--accent) 16%,var(--surface))');assert.equal(declaration(w,'.flashcard-back','color'),'var(--ink)');assert.equal(declaration(w,'.flashcard.is-flipped .flashcard-flip','color'),'var(--ink)');
      const channels=hex=>hex.slice(1).match(/../g).map(value=>parseInt(value,16)),a=channels(accent),b=channels(surface),mixed=a.map((value,i)=>Math.round(value*.16+b[i]*.84)),background='#'+mixed.map(value=>value.toString(16).padStart(2,'0')).join('');
      assert.ok(mixed.every((value,i)=>Math.abs(value-b[i])<=38),'background stays close to the original surface');assert.ok(contrast(background,ink)>=4.5,mode+'/'+palette+' word, IPA and hint contrast');
      assert.ok(contrast(accent,resolveToken(w,root,'--ipa-selection-ink'))>=4.5,mode+'/'+palette+' IPA selection contrast');
    }
    finally{w.close();}
  }
});
