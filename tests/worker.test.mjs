import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
const bundled=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'a-long-testing-password'}}));
const origin='https://wordnest.example';
async function request(path,method='GET',data,cookie,extraHeaders={}){const response=await mf.dispatchFetch(origin+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extraHeaders},...(data!==undefined?{body:JSON.stringify(data)}:{})});const text=await response.text();let parsed;try{parsed=JSON.parse(text);}catch{throw new Error(`${path}: ${response.status} ${text}`);}return {response,data:parsed};}
test('D1 API: bootstrap, auth, CRUD, conflict control, import and session protection',async()=>{
  try{
    let result=await request('/api/sets');assert.equal(result.response.status,200);assert.equal(result.data.sets.length,0);
    result=await request('/api/session');assert.equal(result.data.authenticated,false);
    const set={title:'API test',words:[{english:'save',meaning:'保存する',explanation:'Save your work.'}]};
    result=await request('/api/sets','POST',set);assert.equal(result.response.status,401);
    result=await request('/api/login','POST',{password:'wrong-password'});assert.equal(result.response.status,401);
    result=await request('/api/login','POST',{password:'a-long-testing-password'});assert.equal(result.response.status,200);
    const cookie=result.response.headers.get('set-cookie').split(';')[0];assert.match(result.response.headers.get('set-cookie'),/HttpOnly/);assert.match(result.response.headers.get('set-cookie'),/Secure/);
    result=await request('/api/session','GET',undefined,cookie);assert.equal(result.data.authenticated,true);
    result=await request('/api/sets','POST',set,cookie,{Origin:'https://attacker.example'});assert.equal(result.response.status,403);
    result=await request('/api/sets','POST',{sets:[set,{...set,title:'Second set'}]},cookie);assert.equal(result.response.status,201);assert.equal(result.data.sets.length,2);
    const saved=result.data.sets[0];assert.equal(saved.revision,1);
    assert.deepEqual(result.data.orderedIds,result.data.sets.map(s=>s.id));
    const originalIds=result.data.sets.map(s=>s.id),reversed=[...originalIds].reverse(),initialOrderRevision=result.data.orderRevision;
    result=await request('/api/sets/order','PUT',{ids:reversed,revision:initialOrderRevision});assert.equal(result.response.status,401);
    result=await request('/api/sets/order','PUT',{ids:[saved.id,saved.id],revision:initialOrderRevision},cookie);assert.equal(result.response.status,400);
    result=await request('/api/sets/order','PUT',{ids:[saved.id],revision:initialOrderRevision},cookie);assert.equal(result.response.status,409);
    result=await request('/api/sets/order','PUT',{ids:[saved.id,'missing-id'],revision:initialOrderRevision},cookie);assert.equal(result.response.status,409);
    result=await request('/api/sets/order','PUT',{ids:reversed,revision:initialOrderRevision},cookie);assert.equal(result.response.status,200);const orderRevision=result.data.orderRevision;
    result=await request('/api/sets');assert.deepEqual(result.data.sets.map(s=>s.id),reversed);assert.equal(result.data.orderRevision,orderRevision);
    result=await request('/api/sets/order','PUT',{ids:originalIds,revision:initialOrderRevision},cookie);assert.equal(result.response.status,409);

    result=await request(`/api/sets/${saved.id}`,'PUT',{...set,title:'Updated',revision:1},cookie);assert.equal(result.data.set.revision,2);
    result=await request(`/api/sets/${saved.id}`,'PUT',{...set,revision:1},cookie);assert.equal(result.response.status,409);
    result=await request(`/api/sets/${saved.id}?revision=1`,'DELETE',undefined,cookie);assert.equal(result.response.status,409);
    result=await request('/api/sets');assert.equal(result.data.sets.find(s=>s.id===saved.id).title,'Updated');assert.deepEqual(result.data.sets.map(s=>s.id),reversed);assert.equal(result.data.orderRevision,orderRevision);
    result=await request(`/api/sets/${saved.id}?revision=2`,'DELETE',undefined,cookie);assert.equal(result.response.status,200);
    result=await request('/api/sets','POST',{sets:[set,{title:'Bad',words:[]}]},cookie);assert.equal(result.response.status,400);
    result=await request('/api/sets');assert.equal(result.data.sets.length,1);assert.ok(result.data.orderRevision>orderRevision);
    result=await request('/api/sets/order','PUT',{ids:reversed,revision:orderRevision},cookie);assert.equal(result.response.status,409);
    result=await request('/api/session','GET',undefined,cookie.slice(0,-4)+'oops');assert.equal(result.data.authenticated,false);
    result=await request('/api/logout','POST',{},cookie);assert.match(result.response.headers.get('set-cookie'),/Max-Age=0/);
    for(let i=0;i<11;i++)result=await request('/api/login','POST',{password:'wrong'});assert.equal(result.response.status,429);
  }finally{await mf.dispose();}
});

test('upgrading removes the untouched legacy example and preserves edited data',async()=>{
  const {seed}=await import('./fixture.js');
  for(const revision of [1,2]){
    const instance=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB']}));
    try{
      const db=await instance.getD1Database('DB');
      await db.prepare('CREATE TABLE sets (id TEXT PRIMARY KEY, title TEXT NOT NULL, words TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)').run();
      await db.prepare('INSERT INTO sets VALUES (?,?,?,?,?)').bind('starter-essentials',seed.title,JSON.stringify(seed.words),revision,new Date().toISOString()).run();
      await db.prepare('INSERT INTO sets VALUES (?,?,?,?,?)').bind('user-created','My words',JSON.stringify(seed.words),1,new Date().toISOString()).run();
      const response=await instance.dispatchFetch(origin+'/api/sets');const data=await response.json();
      assert.equal(data.sets.length,revision===1?1:2);assert.ok(data.sets.some(s=>s.id==='user-created'));assert.equal(data.sets.some(s=>s.id==='starter-essentials'),revision!==1);
    }finally{await instance.dispose();}
  }
});
