import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {releaseHistory} from '../public/changelog.js';
import {messages,translator} from '../public/i18n.js';
import {icon} from '../public/icons.js';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import * as accountTools from '../public/accounts.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const {version}=JSON.parse(await readFile('package.json','utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('release notes have paired languages, unique descending versions, and the current package release',()=>{
  assert.equal(releaseHistory[0].version,version);
  assert.equal(new Set(releaseHistory.map(release=>release.version)).size,releaseHistory.length);
  for(const [index,release] of releaseHistory.entries()){
    assert.match(release.version,/^\d+\.\d+\.\d+$/);
    for(const lang of ['en','ja']){
      assert.ok(release[lang].title.trim());assert.ok(release[lang].changes.length);
      assert.ok(release[lang].changes.every(change=>typeof change==='string' && change.trim()));
    }
    assert.equal(release.en.changes.length,release.ja.changes.length);
    if(index){const previous=releaseHistory[index-1].version.split('.').map(Number),current=release.version.split('.').map(Number);assert.ok(previous[0]>current[0] || previous[0]===current[0] && (previous[1]>current[1] || previous[1]===current[1] && previous[2]>current[2]));}
  }
});
test('Changelog is public below Guide, opens on deep links despite set-loading failure, and follows language and theme changes',async()=>{
  for(const lang of ['en','ja'])for(const authenticated of [false,true]){
    const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/#/history',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
    Object.assign(w,core,statistics,personalTools,rankingTools,accountTools,{releaseHistory,icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});
    w.Audio=class{play(){return Promise.resolve();}};w.document.hasFocus=()=>true;
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    w.fetch=async path=>{
      if(path==='/api/sets'){if(!authenticated)throw new Error('Offline fixture');return {ok:true,json:async()=>({sets:[],orderRevision:0})};}
      if(path==='/api/session')return {ok:true,json:async()=>({authenticated,configured:true})};
      if(path==='/api/account/session')return {ok:true,json:async()=>({user:null})};
      throw new Error('Offline fixture');
    };
    w.localStorage.setItem('wordnest-language',lang);w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));
    const find=s=>w.document.querySelector(s),click=async s=>{assert.ok(find(s),s);find(s).click();await tick();await tick();};
    try{
      w.eval(source);await tick();await tick();
      assert.equal(w.document.title,`Wordnest — ${messages[lang].history}`);
      const nav=[...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.dataset.nav);
      assert.deepEqual(nav,authenticated?['home','stats','rankings','guide','history','edit','admin']:['home','stats','rankings','guide','history']);
      assert.equal(find('.nav').style.getPropertyValue('--nav-count'),authenticated?'7':'5');
      assert.equal(find('.history-version').textContent,`wordnest v${version}`);
      assert.equal(w.document.querySelectorAll('.history-entry').length,releaseHistory.length);
      assert.equal(w.document.querySelectorAll('.history-entry[open]').length,1);
      assert.equal(find('.history-entry-title').textContent,releaseHistory[0][lang].title);
      const older=w.document.querySelectorAll('.history-entry')[1];older.open=true;assert.ok(older.textContent.includes(releaseHistory[1][lang].changes[0]));older.open=false;
      await click('[data-action="settings"]');find('#theme-choice').value='dark';find('#theme-choice').dispatchEvent(new w.Event('change',{bubbles:true}));find('#dark-palette').value='graphite';find('#dark-palette').dispatchEvent(new w.Event('change',{bubbles:true}));
      const other=lang==='en'?'ja':'en';find('#settings-language').value=other;find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));await click('[data-dialog="cancel"]');
      assert.equal(find('.history-entry-title').textContent,releaseHistory[0][other].title);assert.equal(w.document.title,`Wordnest — ${messages[other].history}`);assert.equal(w.document.documentElement.dataset.palette,'graphite');
      await click('.nav [data-nav="guide"]');assert.ok(find('.guide-view'));await click('.nav [data-nav="history"]');assert.equal(w.location.hash,'#/history');assert.ok(find('.history-view'));
      w.fetch=async()=>{throw new Error('Offline fixture');};await click('.nav [data-nav="home"]');
      if(!authenticated){assert.ok(find('[data-action="reload"]'));await click('[data-action="reload"]');}
      await click('.nav [data-nav="history"]');assert.ok(find('.history-view'));assert.equal(find('.loading'),null);
    }finally{w.close();}
  }
});
