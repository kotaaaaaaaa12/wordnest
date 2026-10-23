import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {AccountClient} from '../public/accounts.js';
import {LearningTracker,localDay} from '../public/stats.js';
import {PersonalWords,FlashcardBookmarks} from '../public/personal.js';
import {RankingClient} from '../public/rankings.js';
import {emptyStudy,applyStudyOperation,accountStudySummary} from '../public/account-study.js';
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const password='a long unique password phrase',origin='https://wordnest.example';
const instance=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'a-long-admin-password'}}));
export function memoryStorage(){const values=new Map();return {get length(){return values.size;},key:index=>[...values.keys()][index] ?? null,getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function transport(mf){let cookie='',offline=false;const fetch=async(path,options={})=>{if(offline)throw new Error('Offline');const response=await mf.dispatchFetch(origin+path,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});if(response.headers.has('Set-Cookie'))cookie=response.headers.get('Set-Cookie').split(';')[0];return response;};return {fetch,get cookie(){return cookie;},set offline(value){offline=value;},get offline(){return offline;}};}
async function api(connection,path,method='GET',data,extra={}){const response=await connection.fetch(path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,headers:response.headers,data:await response.json()};}
function device(mf){const raw=memoryStorage(),connection=transport(mf),account=new AccountClient({storage:raw,fetch:connection.fetch});let tracker=new LearningTracker({storage:account.storage}),personal=new PersonalWords(account.storage),cards=new FlashcardBookmarks(account.storage);const ranking=new RankingClient({account,storage:account.storage,fetch:connection.fetch,snapshot:()=>({epoch:tracker.epoch,timezone:'UTC',days:tracker.snapshot().days})});
 account.beforeSwitch=()=>tracker.setActive(false);account.onSwitch=()=>{tracker=new LearningTracker({storage:account.storage});personal=new PersonalWords(account.storage);cards=new FlashcardBookmarks(account.storage);ranking.profile=null;};account.onSync=()=>{tracker.syncReset();personal.memory.clear();personal.syncResets();cards.pending.clear();};
 return {raw,connection,account,ranking,get tracker(){return tracker;},get personal(){return personal;},get cards(){return cards;}};
}
test('accounts separate private IDs from display names, hash credentials, isolate sessions, and revoke credentials on password changes and recovery',async()=>{
 const mf=instance(),a=transport(mf),b=transport(mf),other=transport(mf);
 try{
  const registration=await api(a,'/api/account/register','POST',{loginId:'Private_ID',password,name:'Same display name',enabled:true,timezone:'UTC',entries:{}});
  assert.equal(registration.status,201);assert.equal(registration.data.user.loginId,'private_id');assert.match(registration.headers.get('Set-Cookie'),/HttpOnly; SameSite=Strict/);assert.match(registration.headers.get('Set-Cookie'),/Secure/);
  const recovery=registration.data.recoveryCode,id=registration.data.user.id;
  const db=await mf.getD1Database('DB'),row=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();assert.notEqual(row.password_hash,password);assert.notEqual(row.recovery_hash,recovery.replaceAll('-',''));assert.equal(row.password_salt.length,64);
  assert.equal((await api(other,'/api/account/register','POST',{loginId:'PRIVATE_id',password,name:'Other',enabled:true,timezone:'UTC',entries:{}})).status,409);
  assert.equal((await api(other,'/api/account/register','POST',{loginId:'different_id',password,name:'Same display name',enabled:false,timezone:'UTC',entries:{}})).status,201,'public names need not be unique');
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'private_ID',password:'wrong password phrase'})).data.error,'accountWrongCredentials');
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'PRIVATE_ID',password})).status,200);
  assert.equal((await api(b,'/api/session')).data.authenticated,false,'learner authentication never grants administration');
  assert.equal((await api(b,'/api/sets','POST',{title:'Private write',words:[]})).status,401);
  assert.equal((await api(b,'/api/account/password','POST',{currentPassword:'wrong',password:'replacement password phrase'})).status,401);
  const changed=await api(a,'/api/account/password','POST',{currentPassword:password,password:'replacement password phrase'});assert.equal(changed.status,200);assert.ok(changed.data.recoveryCode);
  assert.equal((await api(b,'/api/account/session')).data.user,null);assert.equal((await api(a,'/api/account/session')).data.user.id,id);
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'private_id',password})).status,401);
  assert.equal((await api(b,'/api/account/recover','POST',{loginId:'private_id',recoveryCode:recovery,password:'recovered password phrase'})).status,401,'old recovery codes are invalidated by password changes');
  const restored=await api(b,'/api/account/recover','POST',{loginId:'private_id',recoveryCode:changed.data.recoveryCode,password:'recovered password phrase'});assert.equal(restored.status,200);assert.ok(restored.data.recoveryCode);
  assert.equal((await api(a,'/api/account/session')).data.user,null);assert.equal((await api(b,'/api/account/session')).data.user,null,'recovery requires an explicit new login');
  assert.equal((await api(b,'/api/account/recover','POST',{loginId:'private_id',recoveryCode:changed.data.recoveryCode,password:'another recovered password'})).status,401);
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'private_id',password:'recovered password phrase'})).status,200);
  assert.equal((await api(b,'/api/account/logout','POST',{})).status,200);assert.equal((await api(b,'/api/account/session')).data.user,null);
  assert.equal((await api(a,'/api/account/register','POST',{loginId:'id',password:'short'})).status,400);assert.equal((await api(a,'/api/account/register','POST',null)).status,400);
  await db.prepare('UPDATE login_limits SET attempts=20').run();assert.equal((await api(a,'/api/account/login','POST',{loginId:'private_id',password:'recovered password phrase'})).status,429);
  assert.equal((await api(a,'/api/account/login','POST',{loginId:'private_id',password}, {Origin:'https://attacker.example'})).status,403);
 }finally{await mf.dispose();}
});
test('two devices merge study shards, overlapping time, clear directions, question streaks, favorites and bookmarks without duplicate rankings or stale reset resurrection',async()=>{
 const mf=instance(),a=device(mf),b=device(mf),question=[{key:'same-question'}],word='word-key';
 try{
  a.tracker.answer(false);a.personal.answer(question,false);a.personal.answer(question,false);a.personal.toggleFavorite(word);
  const clear={key:'stable-set',scope:'all-first-pass','en-ja':true,'ja-en':false};a.account.storage.setItem('wordnest-progress',JSON.stringify({seed:clear}));
  await a.ranking.join('Visible name');const legacy=a.ranking.preferences(),legacyId=legacy.id;
  const registration=await a.account.register({loginId:'my_private_id',password,name:'Visible name',enabled:true});assert.equal(a.account.user.id,legacyId);assert.equal(a.tracker.snapshot().answered,1);assert.equal(a.personal.record('same-question').weak,true);assert.equal(a.personal.favorite(word),true);
  assert.equal(a.raw.getItem('wordnest-progress'),null,'transferred guest records are removed only after registration succeeds');
  await b.account.login('MY_PRIVATE_ID',password);assert.equal(b.tracker.snapshot().answered,1);assert.equal(b.personal.favorite(word),true);assert.equal(b.personal.record('same-question').weak,true);
  const start=Date.now()-20000;
  for(const d of [a,b]){d.tracker.setActive(true,start);d.tracker.touch(start+10000);d.tracker.setActive(false,start+10000);d.tracker.answer(true);}
  a.personal.answer(question,true);b.personal.answer(question,true);
  b.account.storage.setItem('wordnest-progress',JSON.stringify({seed:{...clear,'en-ja':false,'ja-en':true}}));
  await Promise.all([a.account.sync(),b.account.sync()]);await a.account.sync();
  assert.equal(a.tracker.snapshot().answered,3);assert.equal(a.tracker.snapshot().correct,2);assert.equal(a.tracker.snapshot().totalMs,10000,'overlapping study intervals are counted once');
  assert.equal(a.personal.record('same-question').successes,2);a.personal.answer(question,true);await a.account.sync();await b.account.sync();assert.equal(b.personal.record('same-question').weak,false,'normal-quiz answers across devices contribute to three consecutive successes');
  assert.equal(JSON.parse(a.account.storage.getItem('wordnest-progress')).seed['en-ja'],true);assert.equal(JSON.parse(a.account.storage.getItem('wordnest-progress')).seed['ja-en'],true);
  a.personal.toggleFavorite(word);await a.account.sync();await b.account.sync();assert.equal(b.personal.favorite(word),false);
  const base=[{front:'apple',back:'りんご'},{front:'book',back:'本'}],deck=a.cards.start('seed',base,'en-ja','original');deck.index=1;deck.flipped=true;a.cards.save(deck);await a.account.sync();await b.account.sync();assert.equal(b.cards.restore('seed',base).index,1);assert.equal(b.cards.restore('seed',base).flipped,true);
  await a.ranking.sync(true);await b.ranking.sync(true);const board=await a.ranking.list('answered');assert.equal(board.rows.length,1);assert.equal(board.mine.name,'Visible name');assert.equal(board.mine.value,3);assert.ok(!JSON.stringify(board).includes('my_private_id'));
  await b.ranking.join('Renamed display');await a.ranking.sync(true);assert.equal(a.ranking.preferences().name,'Renamed display');assert.equal(a.account.user.loginId,'my_private_id');assert.equal((await a.ranking.list('answered')).mine.value,3);
  await b.ranking.decline();await a.ranking.sync(true);assert.equal(a.ranking.preferences().choice,'declined');assert.equal((await a.ranking.list('answered')).rows.length,0);
  const admin=transport(mf);await api(admin,'/api/login','POST',{password:'a-long-admin-password'});const privateStats=await api(admin,'/api/admin/rankings/'+a.account.user.id+'/stats');assert.equal(privateStats.status,200);assert.equal(privateStats.data.summary.answered,3);assert.equal(privateStats.data.participant.enabled,false);
  await b.ranking.join('Renamed display');const removed=await api(admin,'/api/admin/rankings/'+a.account.user.id+'/remove','POST',{revision:b.ranking.profile.revision,name:'Renamed display',messageJa:'別の表示名を設定してください。',messageEn:'Choose a different display name.'});assert.equal(removed.status,200);
  await a.ranking.sync(true);assert.equal(a.ranking.preferences().choice,'declined');const notice=a.ranking.preferences().notice;assert.ok(notice);await a.ranking.acknowledgeNotice(notice.id);await assert.rejects(a.ranking.join('Renamed display'),/rankingNameUnchanged/);await a.ranking.join('Allowed display');assert.equal((await a.ranking.list('answered')).mine.name,'Allowed display');
  assert.equal((await api(a.connection,'/api/ranking/stats','PUT',{revision:a.ranking.profile.revision})).data.error,'accountStatsManaged');
  const anonymous=transport(mf);assert.equal((await api(anonymous,'/api/ranking/profile','GET',undefined,{Authorization:'Bearer '+legacy.token})).status,401,'old guest bearer tokens cannot modify a claimed account');
  b.connection.offline=true;b.tracker.answer(false);b.personal.answer(question,false);await assert.rejects(b.account.sync(),/networkError/);
  a.tracker.reset();a.personal.reset('question');await a.account.sync();b.connection.offline=false;await b.account.sync();await a.account.sync();assert.equal(a.tracker.snapshot().answered,0);assert.equal(b.tracker.snapshot().answered,0);assert.equal(b.personal.record('same-question').mistakes,0);
  b.tracker.answer(true);await b.account.sync();await a.account.sync();assert.equal(a.tracker.snapshot().answered,1);
  const wrong=await api(a.connection,'/api/account/sync','POST',{accountId:'0'.repeat(64),operations:[],timezone:'UTC'});assert.equal(wrong.status,409);
  const outbox=a.account.pending();assert.equal(outbox.length,0);await a.account.logout();assert.equal(a.tracker.snapshot().answered,0,'account records do not leak into guest storage');await a.account.login('my_private_id',password);assert.equal(a.tracker.snapshot().answered,1);

 }finally{await mf.dispose();}
});
test('offline outboxes survive reloads and lost responses, guest imports deduplicate, and an offline logout cannot silently sign back in',async()=>{
 const mf=instance(),a=device(mf),b=device(mf);
 try{
  a.tracker.answer(true);await a.account.register({loginId:'offline_user',password,name:'Offline learner',enabled:true});
  b.tracker.answer(false);const guestRanking=new RankingClient({storage:b.raw,fetch:b.connection.fetch,snapshot:()=>({epoch:b.tracker.epoch,timezone:'UTC',days:b.tracker.snapshot().days})});await guestRanking.join('Old guest');const guestPrefs=guestRanking.preferences();
  await b.account.login('offline_user',password);assert.equal(b.tracker.snapshot().answered,1,'logging in does not silently merge another guest profile');await b.account.importGuest();assert.equal(b.tracker.snapshot().answered,2);await b.account.importGuest();assert.equal(b.tracker.snapshot().answered,2,'repeated guest transfers cannot double-count shared shards');
  const anonymous=transport(mf);assert.equal((await api(anonymous,'/api/ranking/profile','GET',undefined,{Authorization:'Bearer '+guestPrefs.token})).status,401);
  const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ranking_profiles').first()).count,1);
  a.tracker.answer(true);const normal=a.account.fetch;let drop=true;
  a.account.fetch=async(path,options)=>{const response=await normal(path,options);if(drop && path==='/api/account/sync'){drop=false;throw new Error('Lost response');}return response;};
  await assert.rejects(a.account.sync(),/networkError/);assert.ok(a.account.pending().length);await a.account.sync();assert.equal(a.account.pending().length,0);assert.equal(a.tracker.snapshot().answered,3);
  a.connection.offline=true;a.tracker.answer(false);await assert.rejects(a.account.sync(),/networkError/);const pending=a.account.pending().length;await a.account.logout();assert.equal(a.account.user,null);assert.equal(a.account.signoutPending,true);
  const reloaded=new AccountClient({storage:a.raw,fetch:a.connection.fetch});await reloaded.initialize();assert.equal(reloaded.user,null);assert.equal(reloaded.signoutPending,true);a.connection.offline=false;await reloaded.initialize();assert.equal(reloaded.user,null);assert.equal(reloaded.signoutPending,false);assert.equal((await api(a.connection,'/api/account/session')).data.user,null);
  await a.account.login('offline_user',password);assert.equal(a.account.pending().length,0);assert.equal(a.tracker.snapshot().answered,4);assert.ok(pending>0);
  const operation={id:crypto.randomUUID(),type:'set',category:'favorite',epoch:'',key:'wordnest-personal-v1:favorite:test',value:{on:true}};
  const payload={accountId:a.account.user.id,timezone:'UTC',operations:[operation]};assert.equal((await api(a.connection,'/api/account/sync','POST',payload)).status,200);assert.equal((await api(a.connection,'/api/account/sync','POST',payload)).status,200);
  assert.equal((await api(a.connection,'/api/account/sync','POST',{...payload,operations:[{...operation,value:{on:false}}]})).status,400,'operation IDs cannot be reused with different payloads');
  await db.prepare('DELETE FROM account_sessions WHERE account_id=?').bind(a.account.user.id).run();a.tracker.answer(true);await assert.rejects(a.account.sync(),/accountUnauthorized/);assert.equal(a.account.expired,true);assert.ok(a.account.pending().length);await a.account.login('offline_user',password);assert.equal(a.tracker.snapshot().answered,5);
 }finally{await mf.dispose();}
});
test('shared account reducers reject malformed records and merge overlapping intervals across timezones',()=>{
 const study=emptyStudy(),today=localDay(Date.now()),midnight=Date.parse(today+'T00:00:00Z'),key='wordnest-learning-v1:tokyo',op={id:crypto.randomUUID(),type:'set',category:'learning',epoch:'',key,value:{version:1,epoch:'',days:{[today]:{answered:1,correct:1,flips:2,intervals:[[midnight-9*3600000,midnight-9*3600000+10000]]}}}};
 applyStudyOperation(study,op);applyStudyOperation(study,{...op,id:crypto.randomUUID()});assert.equal(accountStudySummary(study,today).summary.totalMs,10000);assert.equal(accountStudySummary(study,today).summary.answered,1);
 assert.throws(()=>applyStudyOperation(study,{...op,value:{version:1,days:{[today]:{answered:1,correct:2,flips:0,intervals:[]}}}}),/accountInvalidData/);
 applyStudyOperation(study,{id:crypto.randomUUID(),type:'reset',category:'learning',epoch:'',nextEpoch:'new-epoch'});applyStudyOperation(study,{...op,id:crypto.randomUUID()});assert.equal(accountStudySummary(study,today).summary.answered,0);
});
// Bypass the browser lock for the second response to exercise the revision fallback.
test('older tab responses cannot roll back a newer reset, and only unsent snapshots are coalesced',async()=>{
 const mf=instance(),a=device(mf);
 try{
  await a.account.register({loginId:'tab_user',password,name:'Tabs',enabled:false});
  const b=new AccountClient({storage:a.raw,fetch:a.connection.fetch});
  for(let index=0;index<20;index++)a.tracker.answer(true);
  assert.equal(a.account.pending().filter(entry=>entry.op.category==='learning').length,1,'unsent learning snapshots coalesce');
  let resolveStarted,release;const started=new Promise(resolve=>resolveStarted=resolve),gate=new Promise(resolve=>release=resolve),normal=a.account.fetch;let hold=true;
  a.account.fetch=async(path,options)=>{const response=await normal(path,options);if(hold && path==='/api/account/sync'){hold=false;resolveStarted();await gate;}return response;};
  const old=a.account.sync();await started;
  b.storage.setItem('wordnest-reset-learning',crypto.randomUUID());await b.flush();release();await old;
  a.tracker.syncReset();assert.equal(a.tracker.snapshot().answered,0);assert.equal(Number(a.raw.getItem('wordnest-user:'+a.account.user.id+':revision')),2);
  a.tracker.answer(true);await a.account.sync();assert.equal(a.tracker.snapshot().answered,1);
 }finally{await mf.dispose();}
});
