import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { summarizeStudyDays, LearningTracker } from '../public/stats.js';
import { RankingClient, rankingMetrics, RANKING_KEY } from '../public/rankings.js';
import { rankingSchema } from '../src/rankings.js';
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const instance=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'moderation-admin-password'}}));
function storage(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};}
const origin='https://wordnest.example';
async function api(mf,path,{method='GET',body,token,cookie,headers={}}={}){const response=await mf.dispatchFetch(origin+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function login(mf){return (await api(mf,'/api/login',{method:'POST',body:{password:'moderation-admin-password'}})).cookie;}
function participant(mf,saved=storage(),fetch=(path,options)=>mf.dispatchFetch(origin+path,options)){
  const tracker=new LearningTracker({storage:saved}),ranking=new RankingClient({storage:saved,fetch,snapshot:()=>({epoch:tracker.epoch,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,days:tracker.snapshot().days})});
  return {saved,tracker,ranking};
}
async function remove(mf,cookie,ranking,ja='不適切な名前のため削除しました。',en='Please choose a different display name.'){
  const profile=(await api(mf,'/api/ranking/profile',{token:ranking.preferences().token})).data.profile;
  return api(mf,'/api/admin/rankings/'+profile.id+'/remove',{method:'POST',cookie,body:{revision:profile.revision,messageJa:ja,messageEn:en}});
}
test('administrators remove participants with private notices; acknowledgement and a genuinely new name are required to rejoin',async()=>{
  const mf=instance(),{tracker,ranking}=participant(mf);
  try{
    for(let i=0;i<31;i++)tracker.answer(i%2===0);tracker.flip();tracker.addTime(Date.now()-5000,Date.now());tracker.persist();await ranking.join('Bad Name');
    const prefs=ranking.preferences(),oldRevision=ranking.profile.revision,cookie=await login(mf);
    assert.equal((await api(mf,'/api/admin/rankings')).status,401);assert.equal((await api(mf,'/api/admin/rankings',{token:prefs.token})).status,401);
    const listed=await api(mf,'/api/admin/rankings?q=Bad',{cookie});assert.equal(listed.status,200);assert.equal(listed.data.total,1);assert.equal(listed.data.participants[0].name,'Bad Name');
    assert.equal((await api(mf,'/api/admin/rankings/'+prefs.id+'/remove',{method:'POST',cookie,headers:{Origin:'https://attacker.example'},body:{revision:oldRevision,messageJa:'Message',messageEn:''}})).status,403);
    for(const [ja,en] of [['',''],['a'.repeat(501),''],['\u0000','']])assert.equal((await remove(mf,cookie,ranking,ja,en)).status,400);
    const deletion=await remove(mf,cookie,ranking,'名前が不適切です。\n<b>名前を変更してください。</b>','');assert.equal(deletion.status,200);assert.ok(deletion.data.noticeId);
    for(const metric of Object.keys(rankingMetrics)){const board=await api(mf,'/api/rankings?metric='+metric);assert.equal(board.data.rows.length,0);assert.equal(JSON.stringify(board.data).includes('不適切'),false);}
    const profile=(await api(mf,'/api/ranking/profile',{token:prefs.token})).data.profile;assert.equal(profile.enabled,false);assert.equal(profile.notice.acknowledged,false);assert.equal(profile.notice.en,'');assert.ok(profile.notice.ja.includes('<b>'));
    assert.equal((await api(mf,'/api/ranking/profile',{token:'0'.repeat(64)})).data.profile,null);
    const rejoin={revision:profile.revision,name:'New Name',enabled:true,epoch:tracker.epoch,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,noticeId:profile.notice.id};
    assert.equal((await api(mf,'/api/ranking/profile',{method:'POST',token:prefs.token,body:rejoin})).data.error,'rankingNoticeRequired');
    await ranking.sync(true);assert.equal(ranking.preferences().choice,'declined');assert.equal(tracker.snapshot().answered,31);assert.equal(ranking.preferences().notice.id,profile.notice.id);
    assert.equal((await api(mf,'/api/ranking/notice',{method:'POST',token:'1'.repeat(64),body:{revision:0,noticeId:profile.notice.id}})).status,409);
    await assert.rejects(ranking.join('New Name'),/rankingNoticeRequired/);await ranking.acknowledgeNotice(profile.notice.id);assert.equal(ranking.preferences().notice.acknowledged,true);
    for(const name of ['Bad Name',' BAD   NAME ','Ｂａｄ Ｎａｍｅ','Bad\u200b Name']){
      assert.equal((await api(mf,'/api/ranking/profile',{method:'POST',token:prefs.token,body:{...rejoin,name}})).data.error,'rankingNameUnchanged');await assert.rejects(ranking.join(name),/rankingNameUnchanged/);
    }
    const removed=await api(mf,'/api/admin/rankings?status=removed',{cookie});assert.equal(removed.data.total,1);assert.equal(removed.data.participants[0].acknowledged,1);assert.ok(removed.data.participants[0].messageJa.includes('不適切'));
    await ranking.join('New Name');assert.equal(ranking.preferences().id,prefs.id);assert.equal(ranking.preferences().notice,null);assert.equal((await ranking.list('answered')).mine.value,31);
    assert.equal((await api(mf,'/api/admin/rankings?status=removed',{cookie})).data.total,0);
    const second=await remove(mf,cookie,ranking,'','A second notice.');assert.equal(second.status,200);assert.notEqual(second.data.noticeId,deletion.data.noticeId);
    assert.equal((await api(mf,'/api/ranking/notice',{method:'POST',token:prefs.token,body:{revision:0,noticeId:deletion.data.noticeId}})).status,409);
    const returning=participant(mf,ranking.storage).ranking;await returning.sync(true);assert.equal(returning.preferences().notice.id,second.data.noticeId);assert.equal(returning.preferences().notice.acknowledged,false);assert.equal(returning.preferences().choice,'declined');
    const db=await mf.getD1Database('DB'),row=await db.prepare('SELECT days,answered,total_ms FROM ranking_profiles WHERE id=?').bind(prefs.id).first();assert.deepEqual(JSON.parse(row.days),tracker.snapshot().days);assert.equal(row.answered,31);assert.equal(row.total_ms,tracker.snapshot().totalMs);
  }finally{await mf.dispose();}
});
test('stale uploads and queued profile edits cannot undo moderation; later acknowledged notices stay confirmed across visits',async()=>{
  const mf=instance();let pause=false,release,started;
  const fetch=async(path,options)=>{if(pause && options.method==='PUT'){pause=false;started();await new Promise(resolve=>{release=resolve;});}return mf.dispatchFetch(origin+path,options);};
  const {ranking,tracker,saved}=participant(mf,storage(),fetch);
  try{
    tracker.answer(true);await ranking.join('Old name');const cookie=await login(mf),stale=ranking.profile.revision;
    const waiting=new Promise(resolve=>{started=resolve;});pause=true;const upload=ranking.sync(true);await waiting;assert.equal((await remove(mf,cookie,ranking)).status,200);release();await upload;
    assert.equal((await ranking.list('answered')).rows.length,0);assert.equal(ranking.preferences().choice,'declined');assert.ok(ranking.preferences().notice);
    const prefs=ranking.preferences();assert.equal((await api(mf,'/api/ranking/stats',{method:'PUT',token:prefs.token,body:{revision:stale,epoch:'',timezone:'UTC',days:{}}})).status,409);
    await ranking.acknowledgeNotice(prefs.notice.id);const returning=participant(mf,saved).ranking;await returning.sync(true);assert.equal(returning.preferences().notice.acknowledged,true);assert.equal(returning.preferences().choice,'declined');
    // A different tab's old pending name edit is canceled by the server notice.
    saved.setItem(RANKING_KEY,JSON.stringify({...returning.preferences(),name:'Queued old edit',choice:'joined',pending:'old-intent',notice:null}));await returning.sync(true);assert.equal(returning.preferences().choice,'declined');assert.equal((await returning.list('answered')).rows.length,0);
  }finally{await mf.dispose();}
});
test('upgrading an existing ranking database creates moderation storage without resetting profiles',async()=>{
  const mf=instance();
  try{
    const db=await mf.getD1Database('DB');await db.prepare(rankingSchema[0]).run();await db.prepare('INSERT INTO ranking_profiles (id,name,timezone,answered,updated_at) VALUES (?,?,?,?,?)').bind('a'.repeat(64),'Existing','Asia/Tokyo',42,new Date().toISOString()).run();
    const board=await api(mf,'/api/rankings?metric=answered');assert.equal(board.status,200);assert.equal(board.data.rows[0].name,'Existing');assert.equal(board.data.rows[0].value,42);assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE name='ranking_moderation'").first());
  }finally{await mf.dispose();}
});

test('a reviewed name tolerates new study uploads while a renamed participant requires a fresh confirmation',async()=>{
  const mf=instance(),{ranking,tracker}=participant(mf);
  try{
    tracker.answer(true);await ranking.join('Reviewed name');const cookie=await login(mf),reviewed={id:ranking.preferences().id,name:'Reviewed name',revision:ranking.profile.revision};
    tracker.answer(true);await ranking.sync(true);
    let response=await api(mf,'/api/admin/rankings/'+reviewed.id+'/remove',{method:'POST',cookie,body:{...reviewed,messageJa:'理由',messageEn:''}});assert.equal(response.status,200);
    await ranking.sync(true);await ranking.acknowledgeNotice(ranking.preferences().notice.id);await ranking.join('Changed name');
    response=await api(mf,'/api/admin/rankings/'+reviewed.id+'/remove',{method:'POST',cookie,body:{...reviewed,messageJa:'Old confirmation',messageEn:''}});assert.equal(response.status,409);assert.equal((await ranking.list('answered')).mine.name,'Changed name');
    assert.equal((await api(mf,'/api/admin/rankings?status=anything',{cookie})).status,400);assert.equal((await api(mf,'/api/admin/rankings?offset=-1',{cookie})).status,400);
  }finally{await mf.dispose();}
});

test('individual statistics require administrator authentication and match synced study days in the participant timezone',async()=>{
  const mf=instance(),{ranking}=participant(mf);
  try{
    await ranking.join('Stats Person');const prefs=ranking.preferences(),path='/api/admin/rankings/'+prefs.id+'/stats';
    assert.equal((await api(mf,path)).status,401);
    assert.equal((await api(mf,path,{token:prefs.token})).status,401);
    const cookie=await login(mf),zone='Pacific/Kiritimati';
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const days={'2001-01-01':{ms:60000,answered:3,correct:1,flips:4},[today]:{ms:120000,answered:1,correct:1,flips:2}};
    const upload=await api(mf,'/api/ranking/stats',{method:'PUT',token:prefs.token,body:{revision:ranking.profile.revision,epoch:'',timezone:zone,days}});assert.equal(upload.status,200);
    const response=await api(mf,path,{cookie});assert.equal(response.status,200);assert.deepEqual(response.data.summary,summarizeStudyDays(days,today));
    assert.equal(response.data.summary.accuracy,0.5);assert.equal(response.data.summary.averageMs,90000);assert.equal(response.data.participant.timezone,zone);assert.equal(response.data.participant.name,'Stats Person');
    assert.equal('days' in response.data,false);assert.equal(JSON.stringify(response.data).includes(prefs.token),false);
    const raw=await mf.dispatchFetch(origin+path,{headers:{Cookie:cookie}});assert.equal(raw.headers.get('cache-control'),'no-store');
    assert.equal((await api(mf,'/api/admin/rankings/'+'f'.repeat(64)+'/stats',{cookie})).status,404);
    assert.equal((await api(mf,'/api/rankings?metric=accuracy')).data.rows.length,0,'public accuracy retains its 30-answer threshold');
    assert.equal('summary' in (await api(mf,'/api/ranking/profile',{token:prefs.token})).data,false);
    // Materialized streaks can be stale: detail must use day totals and the current participant date.
    const db=await mf.getD1Database('DB');await db.prepare('UPDATE ranking_profiles SET days=?,streak=42 WHERE id=?').bind(JSON.stringify({'2001-01-01':days['2001-01-01']}),prefs.id).run();
    assert.equal((await api(mf,path,{cookie})).data.summary.streak,0);
    await ranking.sync(true);await ranking.decline();assert.deepEqual((await api(mf,path,{cookie})).data.summary,summarizeStudyDays({},today));
    await api(mf,'/api/logout',{method:'POST',cookie});
    assert.equal((await api(mf,path)).status,401);
  }finally{await mf.dispose();}
});

test('administrators can search all learners and inspect private records while public boards exclude them',async()=>{
  const mf=instance(),{ranking,tracker}=participant(mf);
  try{
    tracker.answer(true);tracker.answer(false);tracker.flip();await ranking.decline('Private Pat');
    const prefs=ranking.preferences(),cookie=await login(mf),path='/api/admin/rankings/'+prefs.id+'/stats';
    assert.equal(prefs.choice,'declined');assert.ok(prefs.id);
    const all=await api(mf,'/api/admin/rankings?q=Pat',{cookie});assert.equal(all.data.total,1);assert.equal(all.data.participants[0].enabled,0);
    assert.equal((await api(mf,'/api/admin/rankings?status=private&q=Pat',{cookie})).data.total,1);
    assert.equal((await api(mf,'/api/admin/rankings?status=listed&q=Pat',{cookie})).data.total,0);
    assert.equal((await api(mf,path)).status,401);assert.equal((await api(mf,path,{token:prefs.token})).status,401);
    for(const metric of Object.keys(rankingMetrics)){const board=await api(mf,'/api/rankings?metric='+metric+'&self='+prefs.id);assert.equal(board.data.mine,null);assert.equal(board.data.rows.length,0);}
    assert.equal((await api(mf,path,{cookie})).data.summary.answered,2);
    tracker.answer(true);await ranking.sync();assert.equal((await api(mf,path,{cookie})).data.summary.answered,3,'private changes bypass the unchanged-data throttle');
    await ranking.rename('Private Renamed');assert.equal(ranking.preferences().choice,'declined');assert.equal((await api(mf,'/api/admin/rankings?q=Renamed',{cookie})).data.participants[0].name,'Private Renamed');
    await ranking.join('Visible');await ranking.decline();assert.equal((await api(mf,path,{cookie})).data.summary.answered,3,'opt-out preserves records');
    await ranking.join('Visible');assert.equal((await remove(mf,cookie,ranking)).status,200);await ranking.sync(true);tracker.answer(true);await ranking.sync(true);
    assert.equal((await api(mf,path,{cookie})).data.summary.answered,4,'moderated learners continue private syncing');assert.equal((await api(mf,'/api/rankings?metric=answered')).data.rows.length,0);
    await ranking.rename('Private replacement');assert.equal(ranking.preferences().choice,'declined');assert.ok(ranking.preferences().notice);assert.equal((await api(mf,path,{cookie})).data.participant.name,'Private replacement');
    tracker.reset();await ranking.sync(true);assert.equal((await api(mf,path,{cookie})).data.summary.answered,0,'private resets clear server records');
  }finally{await mf.dispose();}
});
test('legacy declined browsers gain stable private identities, retry offline upgrades, and upload on exit',async()=>{
  const mf=instance(),saved=storage();let offline=true;
  saved.setItem(RANKING_KEY,JSON.stringify({choice:'declined'}));
  const {tracker,ranking}=participant(mf,saved,(path,options)=>{if(offline)throw new Error('Offline');return mf.dispatchFetch(origin+path,options);});
  try{
    tracker.answer(true);await assert.rejects(ranking.sync(true),/networkError/);const token=ranking.preferences().token;assert.equal(token.length,64);assert.ok(ranking.preferences().pending);
    offline=false;await ranking.sync(true);assert.equal(ranking.preferences().token,token);assert.match(ranking.preferences().name,/^Learner [a-f0-9]{8}$/);assert.equal(ranking.preferences().choice,'declined');
    const cookie=await login(mf),path='/api/admin/rankings/'+ranking.preferences().id+'/stats';assert.equal((await api(mf,path,{cookie})).data.summary.answered,1);
    tracker.answer(false);ranking.flushOnExit();
    for(let i=0;i<100;i++){if((await api(mf,path,{cookie})).data.summary.answered===2)break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal((await api(mf,path,{cookie})).data.summary.answered,2);assert.equal((await api(mf,'/api/rankings?metric=answered')).data.rows.length,0);
  }finally{await mf.dispose();}
});
