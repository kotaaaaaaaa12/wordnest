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
const boot=await readFile('public/theme.js','utf8'),css=await readFile('public/styles.css','utf8'),source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function create({dark=false,prefs={}}={}) {
  const dom=new JSDOM('<meta name="theme-color"><div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,listeners=[];
  const system={matches:dark,addEventListener(type,callback){if(type==='change')listeners.push(callback);}};
  Object.assign(w,core,statistics,personalTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>system});w.document.hasFocus=()=>true;
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
  function select(selector,value){find(selector).value=value;find(selector).dispatchEvent(new w.Event('change',{bubbles:true}));}
  try{
    w.eval(boot);w.eval(source);await tick();await tick();
    assert.deepEqual([...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.dataset.nav),['home','stats','guide']);
    await click('[data-action="settings"]');assert.equal(find('#light-palette').options.length,3);assert.equal(find('#dark-palette').options.length,3);
    select('#light-palette','ocean');assert.equal(w.document.documentElement.dataset.palette,'ocean');select('#dark-palette','midnight');assert.equal(w.document.documentElement.dataset.palette,'ocean');
    system.matches=true;listeners.forEach(callback=>callback({matches:true}));assert.equal(w.document.documentElement.dataset.theme,'dark');assert.equal(w.document.documentElement.dataset.palette,'midnight');assert.equal(find('meta[name="theme-color"]').content,'#111a27');
    select('#dark-palette','graphite');assert.equal(w.document.documentElement.dataset.palette,'graphite');select('#theme-choice','light');assert.equal(w.document.documentElement.dataset.palette,'ocean');select('#light-palette','lavender');assert.equal(w.document.documentElement.dataset.palette,'lavender');
    select('#settings-language','ja');assert.equal(find('#light-palette').selectedOptions[0].textContent,'ラベンダー');assert.equal(find('#dark-palette').selectedOptions[0].textContent,'グラファイト');
    select('#theme-choice','auto');assert.equal(w.document.documentElement.dataset.palette,'graphite');system.matches=false;listeners.forEach(callback=>callback({matches:false}));assert.equal(w.document.documentElement.dataset.palette,'lavender');
    assert.equal(w.localStorage.getItem('wordnest-light-palette'),'lavender');assert.equal(w.localStorage.getItem('wordnest-dark-palette'),'graphite');assert.equal(w.localStorage.getItem('wordnest-theme'),'auto');
    await click('[data-dialog="cancel"]');assert.deepEqual([...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.textContent.trim()),['学習','学習記録','説明']);
    const reopened=create({dark:true,prefs:{'wordnest-theme':'auto','wordnest-light-palette':w.localStorage.getItem('wordnest-light-palette'),'wordnest-dark-palette':w.localStorage.getItem('wordnest-dark-palette')}}).w;
    try{reopened.eval(boot);assert.equal(reopened.document.documentElement.dataset.palette,'graphite');}finally{reopened.close();}
  }finally{w.close();}
});
