import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import * as core from '../public/core.js';
import * as statistics from '../public/stats.js';
import * as personalTools from '../public/personal.js';
import * as rankingTools from '../public/rankings.js';
import { icon } from '../public/icons.js';
import { messages, translator } from '../public/i18n.js';
import * as zip from 'fflate';
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'');
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const origin='https://wordnest.example',password='publication-test-password';
const example={title:'Public words',words:[{english:'tea',meaning:'Tea meaning',explanation:''}]};
const server=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:password}}));
const request=(mf,path,{method='GET',data,cookie,...headers}={})=>mf.dispatchFetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
async function login(mf){const response=await request(mf,'/api/login',{method:'POST',data:{password}});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
test('publication migrates existing D1 sets and enforces private visibility, revision conflicts, and atomic imports',async()=>{
  const mf=server();
  try{
    const db=await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE sets (id TEXT PRIMARY KEY,title TEXT NOT NULL,words TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)').run();
    await db.prepare('INSERT INTO sets VALUES (?,?,?,?,?)').bind('legacy',example.title,JSON.stringify(example.words),1,new Date().toISOString()).run();
    let data=await(await request(mf,'/api/sets')).json();assert.equal(data.sets[0].published,true);
    const cookie=await login(mf),privateSet={...example,title:'Private vocabulary',published:false};
    let response=await request(mf,'/api/sets',{method:'POST',cookie,data:{sets:[privateSet,{...example,title:'Second public set'}]}});assert.equal(response.status,201);
    data=await response.json();const hidden=data.sets[0];assert.equal(hidden.published,false);const allIds=data.orderedIds;
    data=await(await request(mf,'/api/sets')).json();assert.equal(data.sets.length,2);assert.equal(JSON.stringify(data).includes(hidden.id),false);assert.equal(JSON.stringify(data).includes(privateSet.title),false);
    const tampered=cookie.slice(0,-8)+'tampered';assert.equal((await(await request(mf,'/api/sets',{cookie:tampered})).json()).sets.length,2);
    data=await(await request(mf,'/api/sets',{cookie})).json();assert.equal(data.sets.length,3);assert.deepEqual(data.sets.map(set=>set.id),allIds);
    response=await request(mf,'/api/sets/'+hidden.id,{method:'PUT',data:{...privateSet,published:true,revision:1}});assert.equal(response.status,401);
    response=await request(mf,'/api/sets/'+hidden.id,{method:'PUT',cookie,Origin:'https://attacker.example',data:{...privateSet,published:true,revision:1}});assert.equal(response.status,403);
    response=await request(mf,'/api/sets/'+hidden.id,{method:'PUT',cookie,data:{...example,revision:1}});assert.equal(response.status,200);assert.equal((await response.json()).set.published,false,'older clients preserve the stored visibility');
    response=await request(mf,'/api/sets/'+hidden.id,{method:'PUT',cookie,data:{...privateSet,published:true,revision:1}});assert.equal(response.status,409);
    response=await request(mf,'/api/sets/'+hidden.id,{method:'PUT',cookie,data:{...privateSet,published:true,revision:2}});assert.equal(response.status,200);assert.equal((await response.json()).set.published,true);
    data=await(await request(mf,'/api/sets')).json();assert.equal(data.sets.length,3);assert.deepEqual(data.sets.map(set=>set.id),allIds);
    response=await request(mf,'/api/sets/'+hidden.id,{method:'PUT',cookie,data:{...privateSet,revision:3}});assert.equal(response.status,200);
    const publicData=JSON.stringify(await(await request(mf,'/api/sets')).json());assert.equal(publicData.includes(privateSet.title),false);
    response=await request(mf,'/api/sets',{method:'POST',cookie,data:{sets:[example,{...privateSet,published:'false'}]}});assert.equal(response.status,400);assert.equal((await response.json()).error,'invalidVisibility');
    assert.equal((await(await request(mf,'/api/sets',{cookie})).json()).sets.length,3);
    const columns=(await db.prepare('PRAGMA table_info(sets)').all()).results;assert.equal(columns.filter(column=>column.name==='published').length,1);
  }finally{await mf.dispose();}
});
test('private publication survives JSON and ZIP while legacy files remain public',()=>{
  const hidden={...example,published:false};
  assert.deepEqual(core.parseImport(core.portable(hidden)),[hidden]);
  const files=zip.unzipSync(zip.zipSync({'private.json':zip.strToU8(JSON.stringify(core.portable(hidden))),'legacy.json':zip.strToU8(JSON.stringify(example))}));
  assert.equal(core.parseImport(JSON.parse(zip.strFromU8(files['private.json'])))[0].published,false);
  assert.notEqual(core.parseImport(JSON.parse(zip.strFromU8(files['legacy.json'])))[0].published,false);
  for(const published of ['true',0,null,{},[]])assert.throws(()=>core.validateSet({...example,published}),/invalidVisibility/);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check,label){for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(label);}
test('editor publication switch saves private drafts, reloads the administrator catalog, and removes private screens after logout or expiry',async()=>{
  const mf=server();let dom;
  try{
    let cookie=await login(mf);
    const data=await(await request(mf,'/api/sets',{method:'POST',cookie,data:{sets:[example,{...example,title:'Hidden set',published:false}]}})).json(),hidden=data.sets[1];cookie='';
    dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog><canvas id="confetti"></canvas>',{url:origin+'/#/',runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,find=selector=>w.document.querySelector(selector);
    Object.assign(w,core,statistics,personalTools,rankingTools,{icon,messages,translator,...zip,structuredClone,TextEncoder,TextDecoder,Blob,scrollTo(){},matchMedia:()=>({matches:false})});
    w.document.hasFocus=()=>true;w.Audio=class{play(){return Promise.resolve();}};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){}});
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    w.fetch=async(path,options={})=>{const response=await mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});const updated=response.headers.get('set-cookie');if(updated)cookie=updated.includes('Max-Age=0')?'':updated.split(';')[0];return response;};
    async function click(selector){const element=find(selector);assert.ok(element,selector);element.click();await tick();await tick();}
    function input(selector,value){find(selector).value=value;find(selector).dispatchEvent(new w.Event('input',{bubbles:true}));}
    async function unlock(){await click('[data-action="settings"]');input('#admin-password',password);find('#admin-login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>find('.nav [data-nav="edit"]'),'administrator unlocked');await click('[data-dialog="cancel"]');}
    w.localStorage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined'}));w.eval(source);await waitFor(()=>find('.set-card'),'public catalog');assert.equal(w.document.querySelectorAll('.set-card').length,1);
    await unlock();assert.equal(w.document.querySelectorAll('.set-card').length,2);assert.equal(find('[data-set-id="'+hidden.id+'"] .private-set-label').textContent,'Private');
    await click('.nav [data-nav="edit"]');await click('[data-action="edit-set"][data-id="'+hidden.id+'"]');assert.equal(find('[role="switch"]').getAttribute('aria-checked'),'false');
    const progress={[hidden.id]:{key:core.studyKey(hidden),scope:'all-first-pass','en-ja':true,'ja-en':true}};w.localStorage.setItem('wordnest-progress',JSON.stringify(progress));
    await click('[data-action="toggle-publication"]');assert.equal(find('[role="switch"]').getAttribute('aria-checked'),'true');assert.equal(find('[data-action="toggle-publication"]:focus'),null);assert.equal(find('#dirty-label').textContent,'Unsaved changes');
    assert.equal((await(await request(mf,'/api/sets')).json()).sets.length,1,'draft switch does not publish until saved');
    input('#word-0-meaning','Updated meaning');await click('[data-action="save"]');await waitFor(()=>find('#dirty-label')?.textContent==='','publication saved');
    assert.equal((await(await request(mf,'/api/sets')).json()).sets.length,2);await click('.nav [data-nav="home"]');assert.equal(find('[data-set-id="'+hidden.id+'"]').dataset.studyStatus,'both');
    await click('.nav [data-nav="edit"]');await click('[data-action="new"]');assert.equal(find('[role="switch"]').getAttribute('aria-checked'),'false');input('#set-title','New private set');input('#word-0-english','new');input('#word-0-meaning','New meaning');await click('[data-action="save"]');await waitFor(()=>find('#dirty-label')?.textContent==='','private draft saved');
    assert.equal((await(await request(mf,'/api/sets')).json()).sets.some(set=>set.title==='New private set'),false);
    await click('[data-action="settings"]');find('#settings-language').value='ja';find('#settings-language').dispatchEvent(new w.Event('change',{bubbles:true}));await click('[data-dialog="cancel"]');assert.equal(find('#set-published-label').textContent,'公開設定');assert.equal(find('.publication-status').textContent,'非公開');
    await click('[data-action="settings"]');await click('[data-admin-lock]');await waitFor(()=>!find('.nav [data-nav="edit"]'),'administrator signed out');assert.equal(find('.nav [data-nav="edit"]'),null);assert.equal(w.document.querySelectorAll('.set-card').length,2);assert.equal(find('#app').textContent.includes('New private set'),false);
    await unlock();await click('.nav [data-nav="edit"]');const privateRow=[...w.document.querySelectorAll('[data-action="edit-set"]')].find(button=>button.textContent.includes('New private set'));assert.ok(privateRow);privateRow.click();await tick();input('#set-title','Private unsaved title');cookie='expired';await click('[data-action="save"]');await waitFor(()=>!find('.nav [data-nav="edit"]'),'session expiry');assert.equal(find('#app').textContent.includes('New private set'),false);assert.equal(find('#app').textContent.includes('Private unsaved title'),false);
    await unlock();await click('.nav [data-nav="edit"]');assert.equal(find('#set-title').value,'Private unsaved title','reauthentication restores the unsaved private draft');
  }finally{dom?.window.close();await mf.dispose();}
});
