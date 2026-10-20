import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { LearningTracker, localDay, summarizeStudyDays } from '../public/stats.js';
import { RankingClient, rankingMetrics, RANKING_KEY, rankingName } from '../public/rankings.js';
const bundled=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
function memoryStorage(){const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function instance(){return new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB']}));}
const origin='https://wordnest.example',timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
function transport(mf){return (path,options={})=>mf.dispatchFetch(origin+path,options);}
function client(mf,storage,tracker,fetch=transport(mf)){return new RankingClient({storage,fetch,snapshot:()=>({epoch:tracker.epoch,timezone,days:tracker.snapshot().days})});}
async function api(mf,path,method='GET',body,token){const response=await mf.dispatchFetch(origin+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
test('D1 rankings match all eight local Statistics measures, enforce 30 answers, ties, top 100, ownership, resets, and opt-out',async()=>{
  const mf=instance(),storage=memoryStorage(),today=localDay(Date.now()),yesterday=localDay(Date.now()-86400000),old=localDay(Date.now()-5*86400000);
  const days={[today]:{ms:60000,answered:20,correct:15,flips:3},[yesterday]:{ms:120000,answered:9,correct:5,flips:2},[old]:{ms:30000,answered:0,correct:0,flips:0}};
  storage.setItem('wordnest-learning-v1:historical',JSON.stringify({version:1,days:Object.fromEntries(Object.entries(days).map(([day,data])=>{const [year,month,date]=day.split('-').map(Number),start=new Date(year,month-1,date).getTime();return [day,{...data,intervals:[[start,start+data.ms]]}];}))}));
  const tracker=new LearningTracker({storage,id:'current'}),ranking=client(mf,storage,tracker);
  try{
    await ranking.join('Learner');const prefs=ranking.preferences(),token=prefs.token;assert.equal(token.length,64);assert.notEqual(prefs.id,token);
    for(const metric of Object.keys(rankingMetrics)){
      const board=await ranking.list(metric),value=tracker.snapshot()[metric];
      if(metric==='accuracy'){assert.equal(board.rows.length,0);assert.equal(board.mine,null);assert.equal(board.minimumAnswers,30);}
      else{assert.equal(board.mine.value,value,metric);assert.equal(board.rows[0].value,value,metric);}
    }
    tracker.answer(true);await ranking.sync(true);assert.equal((await ranking.list('accuracy')).mine.value,tracker.snapshot().accuracy);
    const before=ranking.preferences().id;await ranking.join('Renamed');assert.equal(ranking.preferences().id,before);assert.equal((await ranking.list('answered')).mine.name,'Renamed');assert.equal((await ranking.list('answered')).mine.value,30);
    const secondStorage=memoryStorage(),secondTracker=new LearningTracker({storage:secondStorage,id:'second'}),second=client(mf,secondStorage,secondTracker);
    for(let i=0;i<30;i++)secondTracker.answer(true);await second.join('Renamed');let board=await ranking.list('answered');assert.deepEqual(board.rows.map(row=>row.rank),[1,1]);
    assert.equal((await api(mf,'/api/ranking/stats','PUT',{revision:ranking.profile.revision,epoch:'',timezone,days:{}},'0'.repeat(64))).status,409);
    assert.equal((await ranking.list('answered')).mine.value,30);
    const db=await mf.getD1Database('DB');await db.batch(Array.from({length:101},(_,i)=>db.prepare('INSERT INTO ranking_profiles (id,name,timezone,answered,updated_at) VALUES (?,?,?,?,?)').bind((1000+i).toString(16).padStart(64,'0'),'Other '+i,'UTC',1000+i,new Date().toISOString())));
    board=await ranking.list('answered');assert.equal(board.rows.length,100);assert.equal(board.mine.rank,102);assert.equal(board.total,103);assert.ok(!board.rows.some(row=>row.id===prefs.id));
    const staleRevision=ranking.profile.revision,staleEpoch=tracker.epoch;tracker.reset();await ranking.sync(true);assert.equal((await ranking.list('answered')).mine,null);
    assert.equal((await api(mf,'/api/ranking/stats','PUT',{revision:staleRevision,epoch:staleEpoch,timezone,days},token)).status,409);
    tracker.answer(true);await ranking.sync(true);assert.equal((await ranking.list('answered')).mine.value,1);
    await ranking.decline();assert.equal(tracker.snapshot().answered,1);assert.equal((await api(mf,'/api/rankings?metric=answered&self='+prefs.id)).data.mine,null);
    assert.equal((await api(mf,'/api/ranking/stats','PUT',{revision:ranking.profile.revision,epoch:tracker.epoch,timezone,days:tracker.snapshot().days},token)).status,200);
    assert.equal((await api(mf,'/api/rankings?metric=answered&self='+prefs.id)).data.mine,null);
    await ranking.join('Back again');assert.equal(ranking.preferences().id,prefs.id);assert.equal((await ranking.list('answered')).mine.value,1);
    const revision=ranking.profile.revision;
    for(const bad of [{...days,[today]:{ms:-1,answered:1,correct:1,flips:0}},{'2026-99-99':{ms:0,answered:0,correct:0,flips:0}},{[today]:{ms:0,answered:1,correct:2,flips:0}}])assert.equal((await api(mf,'/api/ranking/stats','PUT',{revision,epoch:tracker.epoch,timezone,days:bad},token)).status,400);
    assert.equal((await api(mf,'/api/rankings?metric=unknown')).status,400);assert.equal((await api(mf,'/api/rankings?metric=constructor')).status,400);
    assert.equal((await api(mf,'/api/ranking/profile','POST',{revision,name:'\u202eBad',enabled:true,epoch:tracker.epoch,timezone},token)).status,400);
    assert.equal((await api(mf,'/api/ranking/profile')).status,401);
    assert.equal((await api(mf,'/api/sets','POST',{title:'Unauthorized',words:[{english:'a',meaning:'A'}]},token)).status,401);
  }finally{await mf.dispose();}
});
test('an in-flight old upload cannot undo another tab’s opt-out or learning-data reset; offline changes retry',async()=>{
  const mf=instance(),storage=memoryStorage(),tracker=new LearningTracker({storage,id:'first'});tracker.answer(true);
  let hold=false,release,started,offline=false;
  const normal=transport(mf),delayed=async(path,options)=>{if(offline)throw new Error('Offline');if(hold && path==='/api/ranking/stats' && options.method==='PUT'){hold=false;started();await new Promise(resolve=>{release=resolve;});}return normal(path,options);};
  const first=client(mf,storage,tracker,delayed),otherTracker=new LearningTracker({storage,id:'other'}),second=client(mf,storage,otherTracker);
  try{
    await first.join('Tabs');hold=true;const waiting=new Promise(resolve=>{started=resolve;});const old=first.sync(true);await waiting;await second.decline();release();await old;
    assert.equal((await api(mf,'/api/rankings?metric=answered')).data.rows.length,0);assert.equal(first.preferences().choice,'declined');
    await first.join('Tabs');hold=true;const resetting=new Promise(resolve=>{started=resolve;});const oldReset=first.sync(true);await resetting;otherTracker.reset();await second.sync(true);release();await oldReset;
    assert.equal((await api(mf,'/api/rankings?metric=answered')).data.rows.length,0);assert.equal(tracker.snapshot().answered,0);
    tracker.answer(true);await first.sync(true);assert.equal((await first.list('answered')).mine.value,1);
    offline=true;await assert.rejects(first.decline(),/networkError/);assert.equal(first.preferences().choice,'declined');assert.ok(first.preferences().pending);assert.equal(tracker.snapshot().answered,1);
    offline=false;await first.sync();assert.equal(first.preferences().pending,null);assert.equal((await api(mf,'/api/rankings?metric=answered')).data.rows.length,0);
  }finally{await mf.dispose();}
});
test('shared summary handles calendar gaps, active-day averages, and timezone-local streak dates',()=>{
  const days={'2026-10-17':{ms:10000,answered:1,correct:1,flips:0},'2026-10-18':{ms:20000,answered:1,correct:0,flips:0},'2026-10-20':{ms:0,answered:0,correct:0,flips:1}};
  assert.equal(summarizeStudyDays(days,'2026-10-20').averageMs,10000);assert.equal(summarizeStudyDays(days,'2026-10-20').streak,1);assert.equal(summarizeStudyDays(days,'2026-10-21').streak,1);assert.equal(summarizeStudyDays(days,'2026-10-22').streak,0);assert.equal(summarizeStudyDays(days,'2026-10-22').longest,2);
  assert.equal(rankingName(' 😀 '.repeat(1)),'😀');assert.throws(()=>rankingName('😀'.repeat(21)),/invalidRankingName/);
});
