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
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const instance=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB']}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check,label){for(let i=0;i<400;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(label);}
async function harness(mf,{lang='en',hash='#/',preferences,seed=false}={}){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:'https://wordnest.example/'+hash,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,requests=[];
  Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});w.document.hasFocus=()=>true;
  // Keep periodic background refresh separate from these interaction assertions.
  const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>callback?.name==='learningHeartbeat'?0:timeout(callback,delay,...args);
  w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.localStorage.setItem('wordnest-language',lang);if(preferences)w.localStorage.setItem(rankingTools.RANKING_KEY,JSON.stringify(preferences));
  const tracker=new statistics.LearningTracker({storage:w.localStorage,id:'fixture'});
  if(seed){tracker.addTime(Date.now()-60000,Date.now());for(let i=0;i<29;i++)tracker.answer(i%3!==0);tracker.flip();tracker.persist();}
  w.fetch=(path,options={})=>{requests.push([path,options.method || 'GET']);return mf.dispatchFetch('https://wordnest.example'+path,options);};
  const find=s=>w.document.querySelector(s);
  async function click(s){assert.ok(find(s),s);find(s).click();await tick();await tick();}
  function name(value){find('#ranking-name').value=value;find('#ranking-name-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
  w.eval(source);await waitFor(()=>!find('.loading'),'initial word-set load');await tick();
  return {w,find,click,name,tracker,requests};
}
test('first visit asks for a name outside Rankings, supports declining, and remembers the choice',async()=>{
  const mf=instance();let first,second;
  try{
    first=await harness(mf,{lang:'ja',hash:'#/guide'});await waitFor(()=>first.find('#ranking-name-form'),'first-visit prompt');
    assert.equal(first.find('#modal-title').textContent,'ランキングに参加');assert.ok(first.find('#modal').textContent.includes('参加しない'));
    await first.click('[data-ranking-name-close]');await waitFor(()=>!first.find('#modal').open,'declined');const preferences=JSON.parse(first.w.localStorage.getItem(rankingTools.RANKING_KEY));assert.equal(preferences.choice,'declined');
    await waitFor(()=>JSON.parse(first.w.localStorage.getItem(rankingTools.RANKING_KEY))?.id && !JSON.parse(first.w.localStorage.getItem(rankingTools.RANKING_KEY)).pending,'private profile registration');assert.ok(first.requests.some(([path,method])=>path==='/api/ranking/profile' && method==='POST'));assert.match(JSON.parse(first.w.localStorage.getItem(rankingTools.RANKING_KEY)).name,/^Learner [a-f0-9]{8}$/);await first.click('.nav [data-nav="rankings"]');await waitFor(()=>!first.find('.ranking-loading'),'public rankings');assert.equal(first.w.document.title,'Wordnest — ランキング');assert.ok(first.find('#ranking-metric'));assert.equal(first.find('#ranking-metric').options.length,8);assert.ok(first.find('.rankings-view').textContent.includes('参加していません'));
    second=await harness(mf,{preferences});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(second.find('#ranking-name-form'),null);
  }finally{first?.w.close();second?.w.close();await mf.dispose();}
});
test('rankings show the same eight formatted values as Statistics and support renaming, opting out, rejoining, and record reset',async()=>{
  const mf=instance();let h;
  try{
    h=await harness(mf,{seed:true});const {w,find,click,name,tracker}=h;
    await waitFor(()=>find('#ranking-name-form'),'onboarding');name('<b>Chris</b>');await waitFor(()=>!find('#modal').open,'joined');
    assert.deepEqual([...w.document.querySelectorAll('.nav [data-nav]')].map(link=>link.dataset.nav),['home','stats','rankings','guide']);
    await click('.nav [data-nav="stats"]');const values=Object.fromEntries(Object.values(rankingTools.rankingMetrics).map(key=>[key,find(`[data-stat="${key}"]`).textContent]));
    await click('.nav [data-nav="rankings"]');await waitFor(()=>!find('.ranking-loading'),'rankings loaded');assert.equal(w.document.title,'Wordnest — Rankings');assert.equal(find('.ranking-name').textContent,'<b>Chris</b>');assert.equal(find('.ranking-name b'),null);
    for(const [metric,key] of Object.entries(rankingTools.rankingMetrics)){
      find('#ranking-metric').focus();find('#ranking-metric').value=metric;find('#ranking-metric').dispatchEvent(new w.Event('change',{bubbles:true}));assert.notEqual(w.document.activeElement.tagName,'SELECT');await waitFor(()=>!find('.ranking-loading'),metric);assert.notEqual(w.document.activeElement.tagName,'SELECT');
      const requests=h.requests.length;find('#ranking-metric').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();await tick();assert.equal(h.requests.length,requests,'unchanged selection must not issue another request');
      if(metric==='accuracy'){assert.equal(find('.ranking-self'),null);assert.ok(find('.rankings-view').textContent.includes('30'));}
      else assert.equal(find('.ranking-self td:last-child').textContent,values[key],metric);
    }
    tracker.answer(true);await click('[data-action="ranking-refresh"]');await waitFor(()=>!find('.ranking-loading'),'refresh after answer');
    find('#ranking-metric').value='accuracy';find('#ranking-metric').dispatchEvent(new w.Event('change',{bubbles:true}));await waitFor(()=>!find('.ranking-loading'),'accuracy at 30');const accuracy=find('.ranking-self td:last-child').textContent;
    await click('.nav [data-nav="stats"]');assert.equal(find('[data-stat="accuracy"]').textContent,accuracy);await click('.nav [data-nav="rankings"]');await waitFor(()=>!find('.ranking-loading'),'return');
    await click('[data-action="ranking-name"]');name('A'.repeat(21));await waitFor(()=>!find('#ranking-name-error').hidden,'invalid name');assert.equal(find('#ranking-name-error').textContent,messages.en.invalidRankingName);
    name('New name');await waitFor(()=>!find('#modal').open && !find('.ranking-loading'),'renamed');assert.equal(find('.ranking-name').textContent,'New name');
    const id=JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY)).id;
    await click('[data-action="settings"]');await click('[data-ranking-settings]');await waitFor(()=>find('#ranking-settings') && !JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY)).pending,'disabled');assert.equal(find('[data-ranking-settings]').getAttribute('aria-pressed'),'false');assert.equal(tracker.snapshot().answered,30);
    await click('[data-dialog="cancel"]');await click('[data-action="ranking-refresh"]');await waitFor(()=>!find('.ranking-loading'),'hidden leaderboard');assert.equal(find('.ranking-self'),null);assert.equal(find('.ranking-name'),null);
    await click('[data-action="settings"]');await click('[data-ranking-settings]');await waitFor(()=>find('#ranking-name-form'),'rejoin form');name('Back');await waitFor(()=>find('#ranking-settings') && !JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY)).pending,'rejoined');assert.equal(JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY)).id,id);
    await click('[data-delete-learning="statistics"]');assert.ok(find('#modal').textContent.includes('ranking records'));await click('[data-dialog="confirm"]');await waitFor(()=>find('#ranking-settings'),'reset complete');assert.equal(tracker.snapshot().answered,0);assert.equal(find('[data-ranking-settings]').getAttribute('aria-pressed'),'true');
    await click('[data-dialog="cancel"]');await click('[data-action="ranking-refresh"]');await waitFor(()=>!find('.ranking-loading'),'cleared rankings');assert.equal(find('.ranking-self'),null);
    await click('[data-action="settings"]');find('#settings-language').value='ja';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.title,'Wordnest — ランキング');assert.equal(find('#ranking-settings-title').textContent,'ランキングへの掲載');await click('[data-dialog="cancel"]');assert.equal(find('.rankings-view h1').textContent,'ランキング');
  }finally{h?.w.close();await mf.dispose();}
});

test('declining with a learner name syncs privately and Settings can rename without publishing',async()=>{
  const mf=instance();let h;
  try{
    h=await harness(mf,{seed:true});const {w,find,click}=h;
    await waitFor(()=>find('#ranking-name-form'),'name prompt');assert.ok(find('#modal').textContent.includes(messages.en.learningSyncHelp));find('#ranking-name').value='Hidden learner';await click('[data-ranking-name-close]');
    await waitFor(()=>JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY))?.id && !JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY)).pending,'private name registration');
    await click('.nav [data-nav="rankings"]');await waitFor(()=>!find('.ranking-loading'),'hidden board');assert.equal(find('.ranking-name'),null);
    await click('[data-action="settings"]');await click('[data-ranking-private-name]');await waitFor(()=>find('#ranking-name-form'),'private rename');assert.equal(find('#modal-title').textContent,messages.en.profileChangeName);h.name('Private new name');
    await waitFor(()=>find('#ranking-settings') && !JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY)).pending,'renamed private profile');const prefs=JSON.parse(w.localStorage.getItem(rankingTools.RANKING_KEY));assert.equal(prefs.name,'Private new name');assert.equal(prefs.choice,'declined');assert.equal(find('[data-ranking-settings]').getAttribute('aria-pressed'),'false');
    const db=await mf.getD1Database('DB'),row=await db.prepare('SELECT name,enabled,answered FROM ranking_profiles WHERE id=?').bind(prefs.id).first();assert.equal(row.name,'Private new name');assert.equal(row.enabled,0);assert.equal(row.answered,29);
    assert.ok(find('#ranking-settings').textContent.includes(messages.en.learningSyncHelp));
  }finally{h?.w.close();await mf.dispose();}
});
