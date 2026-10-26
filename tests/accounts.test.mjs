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
test('accounts separate private IDs from display names, hash credentials, isolate sessions, and revoke credentials on password changes without recovery codes',async()=>{
 const mf=instance(),a=transport(mf),b=transport(mf),other=transport(mf);
 try{
  const registration=await api(a,'/api/account/register','POST',{loginId:'Private_ID',password,name:'Same display name',enabled:true,timezone:'UTC',entries:{}});
  assert.equal(registration.status,201);assert.equal(registration.data.user.loginId,'private_id');assert.match(registration.headers.get('Set-Cookie'),/HttpOnly; SameSite=Strict/);assert.match(registration.headers.get('Set-Cookie'),/Secure/);
  assert.equal(Object.hasOwn(registration.data,'recoveryCode'),false);const id=registration.data.user.id;
  const db=await mf.getD1Database('DB'),row=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();assert.notEqual(row.password_hash,password);assert.equal(row.recovery_hash,'');assert.equal(row.password_salt.length,64);
  assert.equal((await api(other,'/api/account/register','POST',{loginId:'PRIVATE_id',password,name:'Other',enabled:true,timezone:'UTC',entries:{}})).status,409);
  assert.equal((await api(other,'/api/account/register','POST',{loginId:'different_id',password,name:'Same display name',enabled:false,timezone:'UTC',entries:{}})).status,201,'public names need not be unique');
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'private_ID',password:'wrong password phrase'})).data.error,'accountWrongCredentials');
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'PRIVATE_ID',password})).status,200);
  assert.equal((await api(b,'/api/session')).data.authenticated,false,'learner authentication never grants administration');
  assert.equal((await api(b,'/api/sets','POST',{title:'Private write',words:[]})).status,401);
  assert.equal((await api(b,'/api/account/password','POST',{currentPassword:'wrong',password:'replacement password phrase'})).status,401);
  const changed=await api(a,'/api/account/password','POST',{currentPassword:password,password:'replacement password phrase'});assert.equal(changed.status,200);assert.equal(Object.hasOwn(changed.data,'recoveryCode'),false);
  assert.equal((await api(b,'/api/account/session')).data.user,null);assert.equal((await api(a,'/api/account/session')).data.user.id,id);
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'private_id',password})).status,401);
  assert.equal((await api(b,'/api/account/recover','POST',{loginId:'private_id',recoveryCode:'a'.repeat(64),password:'recovered password phrase'})).status,410,'legacy recovery endpoint is disabled');
  assert.equal((await api(b,'/api/account/login','POST',{loginId:'private_id',password:'replacement password phrase'})).status,200);
  assert.equal((await api(b,'/api/account/logout','POST',{})).status,200);assert.equal((await api(b,'/api/account/session')).data.user,null);
  assert.equal((await api(a,'/api/account/register','POST',{loginId:'id',password:'short'})).status,400);assert.equal((await api(a,'/api/account/register','POST',null)).status,400);
  await db.prepare('UPDATE login_limits SET attempts=20').run();assert.equal((await api(a,'/api/account/login','POST',{loginId:'private_id',password:'replacement password phrase'})).status,429);
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
test('guest transfers include profile-only guests and retire local data only after an acknowledged sync, including lost responses',async()=>{
 const mf=instance(),a=device(mf),b=device(mf),c=device(mf);
 try{
  await a.account.register({loginId:'guest_transfer',password,name:'Account learner',enabled:true});
  assert.equal(a.account.hasGuestRecords(),false);
  await b.ranking.join('Profile-only guest');const profile=b.account.guestProfile();
  assert.equal(Object.keys(b.account.guestEntries()).length,0);assert.equal(b.account.hasGuestRecords(),true);
  await b.account.login('guest_transfer',password);await b.account.importGuest();
  assert.equal(b.raw.getItem('wordnest-ranking-v1'),null);assert.equal(b.account.hasGuestRecords(),false);
  const db=await mf.getD1Database('DB');assert.equal(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(profile.id).first(),null);
  assert.equal((await api(transport(mf),'/api/ranking/profile','GET',undefined,{Authorization:'Bearer '+profile.token})).status,401);
  c.tracker.answer(false);await c.ranking.join('Guest with records');const guest=c.account.guestProfile(),entries=c.account.guestEntries();
  await c.account.login('guest_transfer',password);c.connection.offline=true;await assert.rejects(c.account.importGuest(),/networkError/);
  assert.deepEqual(c.account.guestEntries(),entries);assert.equal(c.account.guestProfile().token,guest.token);
  c.connection.offline=false;const normal=c.account.fetch;let drop=true;
  c.account.fetch=async(path,options)=>{const response=await normal(path,options);if(drop && path==='/api/account/sync' && JSON.parse(options.body).operations.some(op=>op.type==='import')){drop=false;throw new Error('Lost import response');}return response;};
  await assert.rejects(c.account.importGuest(),/networkError/);assert.equal(c.account.hasGuestRecords(),true);assert.deepEqual(c.account.guestEntries(),entries);
  await c.account.sync();assert.equal(c.account.hasGuestRecords(),false);assert.equal(c.raw.getItem('wordnest-ranking-v1'),null);assert.equal(c.tracker.snapshot().answered,1);assert.equal(c.tracker.snapshot().correct,0);
  assert.equal(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(guest.id).first(),null);
  await a.account.sync();assert.equal(a.tracker.snapshot().answered,1);assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ranking_profiles').first()).count,1);
  await c.account.logout();assert.equal(c.tracker.snapshot().answered,0);
 }finally{await mf.dispose();}
});
test('guest cleanup preserves records and a replacement profile written after the transferred snapshot',()=>{
 const raw=memoryStorage(),account=new AccountClient({storage:raw}),token='a'.repeat(64),replacement='b'.repeat(64),key='wordnest-personal-v1:favorite:example';
 raw.setItem(key,'{"on":false}');raw.setItem('wordnest-ranking-v1',JSON.stringify({token:replacement}));
 account.retireGuest({[key]:'{"on":true}'},token);assert.equal(raw.getItem(key),'{"on":false}');assert.equal(account.guestProfile().token,replacement);
});
test('administrators identify private accounts, reset passwords, and delete accounts without reviving claimed guest credentials',async()=>{
 const mf=instance(),a=device(mf),b=device(mf),admin=transport(mf),anonymous=transport(mf);
 try{
  a.tracker.answer(true);await a.ranking.join('Visible only name');const originalGuest=a.ranking.preferences();
  await a.account.register({loginId:'hidden_login_id',password,name:'Visible only name',enabled:false});const id=a.account.user.id;
  b.tracker.answer(false);await b.ranking.join('Imported guest');const imported=b.ranking.preferences();await b.account.login('hidden_login_id',password);await b.account.importGuest();
  const base='/api/admin/accounts/'+id;
  for(const connection of [anonymous,a.connection]){
   assert.equal((await api(connection,'/api/admin/rankings')).status,401);
   assert.equal((await api(connection,base+'/password','POST',{loginId:'hidden_login_id',password:'new administrator password'})).status,401);
   assert.equal((await api(connection,base,'DELETE',{loginId:'hidden_login_id'})).status,401);
  }
  await api(admin,'/api/login','POST',{password:'a-long-admin-password'});
  const listing=await api(admin,'/api/admin/rankings?q=HIDDEN_LOGIN&kind=accounts');assert.equal(listing.status,200);assert.equal(listing.data.total,1);assert.equal(listing.data.participants[0].loginId,'hidden_login_id');assert.ok(listing.data.participants[0].accountCreatedAt);
  assert.equal((await api(admin,'/api/admin/rankings?kind=guests')).data.total,0);
  assert.equal((await api(admin,'/api/admin/rankings?kind=invalid')).status,400);
  assert.equal((await api(admin,'/api/admin/rankings/'+id+'/stats')).data.participant.loginId,'hidden_login_id');
  assert.ok(!JSON.stringify((await api(anonymous,'/api/rankings')).data).includes('hidden_login_id'));
  assert.ok(!JSON.stringify((await a.ranking.sync(true))).includes('hidden_login_id'));
  assert.equal((await api(admin,base+'/password','POST',{loginId:'wrong',password:'new administrator password'})).data.error,'accountConfirmId');
  assert.equal((await api(admin,base+'/password','POST',{loginId:'hidden_login_id',password:'short'})).data.error,'accountInvalidPassword');
  assert.equal((await api(admin,base+'/password','POST',{loginId:'hidden_login_id',password:'new administrator password'},{Origin:'https://attacker.example'})).status,403);
  const reset=await api(admin,base+'/password','POST',{loginId:'hidden_login_id',password:'new administrator password'});assert.equal(reset.status,200);assert.deepEqual(reset.data,{ok:true});
  assert.equal((await api(a.connection,'/api/account/session')).data.user,null);assert.equal((await api(b.connection,'/api/account/session')).data.user,null);
  await assert.rejects(a.account.sync(),/accountUnauthorized/);assert.equal(a.account.expired,true);
  assert.equal((await api(anonymous,'/api/account/login','POST',{loginId:'hidden_login_id',password})).status,401);
  await a.account.login('hidden_login_id','new administrator password');assert.equal(a.tracker.snapshot().answered,2);
  const db=await mf.getD1Database('DB'),row=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();assert.notEqual(row.password_hash,'new administrator password');assert.equal(row.recovery_hash,'');
  assert.equal((await api(admin,base,'DELETE',{loginId:'wrong'})).data.error,'accountConfirmId');assert.ok(await db.prepare('SELECT id FROM accounts WHERE id=?').bind(id).first());
  assert.equal((await api(admin,base,'DELETE',{loginId:'hidden_login_id'},{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await api(admin,base,'DELETE',{loginId:'hidden_login_id'})).status,200);
  for(const [table,column] of [['accounts','id'],['account_sessions','account_id'],['account_ops','account_id'],['ranking_profiles','id'],['ranking_moderation','profile_id']])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).bind(id).first()).n,0,table);
  assert.equal((await api(a.connection,'/api/account/session')).data.user,null);await a.account.sync();assert.equal(a.account.user,null);assert.equal(a.tracker.snapshot().answered,2);assert.equal(a.ranking.preferences().name,'Visible only name');
  assert.equal((await api(anonymous,'/api/account/login','POST',{loginId:'hidden_login_id',password:'new administrator password'})).status,401);
  assert.equal((await api(admin,'/api/admin/rankings?q=hidden_login_id')).data.total,0);
  for(const token of [originalGuest.token,imported.token]){
   assert.equal((await api(transport(mf),'/api/ranking/profile','GET',undefined,{Authorization:'Bearer '+token})).status,401);
   assert.equal((await api(transport(mf),'/api/account/register','POST',{loginId:'reused_guest',password,name:'Reused guest',enabled:true,timezone:'UTC',entries:{},legacyToken:token})).data.error,'accountAlreadyLinked');
  }
  assert.equal((await api(admin,base+'/password','POST',{loginId:'hidden_login_id',password:'another password phrase'})).status,404);
  const fresh=await api(transport(mf),'/api/account/register','POST',{loginId:'hidden_login_id',password,name:'Fresh account',enabled:false,timezone:'UTC',entries:{}});assert.equal(fresh.status,201);assert.notEqual(fresh.data.user.id,id);assert.deepEqual(fresh.data.study.entries,{});
 }finally{await mf.dispose();}
});
test('deleted accounts become independent guests on reconnect or reload, preserving cached study data, private names, and offline activity',async()=>{
 const mf=instance(),a=device(mf),b=device(mf),admin=transport(mf);
 try{
  a.tracker.answer(true);a.tracker.flip();a.tracker.addTime(Date.now()-10000,Date.now());
  a.personal.answer([{key:'weak-word'}],false);a.personal.answer([{key:'weak-word'}],false);a.personal.toggleFavorite('favorite-word');
  a.account.storage.setItem('wordnest-progress',JSON.stringify({seed:{key:'stable-set',scope:'all-first-pass','en-ja':true,'ja-en':false}}));
  const base=[{front:'apple',back:'りんご'},{front:'book',back:'本'}],deck=a.cards.start('seed',base,'en-ja','original');deck.index=1;deck.flipped=true;a.cards.save(deck);
  a.raw.setItem('wordnest-theme','dark');
  await a.account.register({loginId:'become_guest',password,name:'名前そのまま',enabled:false});const id=a.account.user.id;await a.ranking.sync(true);
  await b.account.login('become_guest',password);await b.ranking.sync(true);const shared=a.tracker.snapshot();
  b.connection.offline=true;b.tracker.answer(false);b.tracker.flip();const offline=b.tracker.snapshot();
  await api(admin,'/api/login','POST',{password:'a-long-admin-password'});assert.equal((await api(admin,'/api/admin/accounts/'+id,'DELETE',{loginId:'become_guest'})).status,200);
  await assert.rejects(b.account.initialize().then(()=>{if(b.account.error)throw new Error(b.account.error);}),/networkError/);assert.equal(b.account.user.id,id);assert.equal(b.tracker.snapshot().answered,offline.answered);
  await a.ranking.sync(true);assert.equal(a.account.user,null);assert.equal(a.account.expired,false);assert.equal(a.account.pending().length,0);assert.equal(a.tracker.snapshot().answered,shared.answered);assert.equal(a.tracker.snapshot().flips,shared.flips);assert.equal(a.tracker.snapshot().totalMs,shared.totalMs);assert.equal(a.tracker.snapshot().correct,shared.correct);
  assert.equal(a.ranking.preferences().name,'名前そのまま');assert.equal(a.ranking.preferences().choice,'declined');assert.ok(a.ranking.preferences().token);assert.notEqual(a.ranking.preferences().id,id);assert.equal(a.personal.record('weak-word').weak,true);assert.equal(a.personal.favorite('favorite-word'),true);assert.equal(JSON.parse(a.account.storage.getItem('wordnest-progress')).seed['en-ja'],true);assert.equal(a.cards.restore('seed',base).index,1);assert.equal(a.raw.getItem('wordnest-theme'),'dark');
  const guestToken=a.ranking.preferences().token;assert.equal(a.account.convertDeletedAccount(id),false);assert.equal(a.tracker.snapshot().answered,shared.answered);
  b.connection.offline=false;await b.account.initialize();assert.equal(b.account.user,null);assert.equal(b.tracker.snapshot().answered,offline.answered);assert.equal(b.tracker.snapshot().flips,offline.flips);assert.equal(b.ranking.preferences().name,'名前そのまま');assert.notEqual(b.ranking.preferences().token,guestToken);await b.ranking.sync(true);
  assert.equal((await a.ranking.list('answered')).rows.length,0,'opt-out remains private for both guests');
  const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM accounts').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ranking_profiles').first()).n,2);
  const reloaded=new AccountClient({storage:a.raw,fetch:a.connection.fetch});await reloaded.initialize();assert.equal(reloaded.user,null);assert.equal(new LearningTracker({storage:reloaded.storage}).snapshot().answered,shared.answered);assert.equal(reloaded.guestProfile().token,guestToken);
  await a.account.register({loginId:'become_guest',password,name:'名前そのまま',enabled:false});assert.notEqual(a.account.user.id,id);assert.equal(a.tracker.snapshot().answered,shared.answered);assert.equal(a.account.guestEntries()['wordnest-progress'],undefined);
 }finally{await mf.dispose();}
});
test('repeated deletion handling in shared-storage tabs keeps one guest identity and does not duplicate the shared study shards',()=>{
 const raw=memoryStorage(),id='d'.repeat(64);raw.setItem('wordnest-account-v1',JSON.stringify({id,loginId:'shared_tabs'}));
 const first=new AccountClient({storage:raw}),other=new AccountClient({storage:raw});
 let tracker=new LearningTracker({storage:first.storage,id:'shared-tab-shard'});tracker.answer(true);first.storage.setItem('wordnest-ranking-v1',JSON.stringify({name:'Preserved name',choice:'joined'}));
 assert.equal(first.convertDeletedAccount(id),true);const token=first.guestProfile().token;
 // A stale tab flushes its final activity after the first tab has converted.
 tracker=new LearningTracker({storage:other.storage,id:'late-tab-shard'});tracker.answer(false);other.storage.setItem('wordnest-ranking-v1',JSON.stringify({name:'Preserved name',choice:'joined'}));
 assert.equal(other.convertDeletedAccount(id),true);assert.equal(other.guestProfile().token,token);assert.equal(other.guestProfile().name,'Preserved name');assert.equal(other.guestProfile().choice,'joined');assert.equal(new LearningTracker({storage:other.storage}).snapshot().answered,2);
 assert.equal(other.convertDeletedAccount(id),false);assert.equal(new LearningTracker({storage:other.storage}).snapshot().answered,2);
});
test('a failed guest conversion retains account caches and can retry without counting records twice',()=>{
 const raw=memoryStorage(),id='f'.repeat(64);raw.setItem('wordnest-account-v1',JSON.stringify({id,loginId:'storage_retry'}));const account=new AccountClient({storage:raw});
 new LearningTracker({storage:account.storage,id:'retry-shard'}).answer(true);account.storage.setItem('wordnest-ranking-v1',JSON.stringify({name:'Keep my name',choice:'declined'}));
 const write=raw.setItem;raw.setItem=(key,value)=>{if(key==='wordnest-ranking-v1')throw new Error('Quota exceeded');write(key,value);};
 assert.throws(()=>account.convertDeletedAccount(id),/accountStorageError/);assert.equal(account.user.id,id);assert.ok(raw.getItem(`wordnest-user:${id}:data:wordnest-learning-v1:retry-shard`));
 raw.setItem=write;assert.equal(account.convertDeletedAccount(id),true);assert.equal(account.user,null);assert.equal(new LearningTracker({storage:account.storage}).snapshot().answered,1);assert.equal(account.guestProfile().name,'Keep my name');
});
test('upgrading a legacy database erases recovery hashes without changing passwords, sessions, or study records',async()=>{
 const mf=instance();
 try{
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE accounts (id TEXT PRIMARY KEY,login_id TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,recovery_hash TEXT NOT NULL,study TEXT NOT NULL,sync_revision INTEGER NOT NULL DEFAULT 0,sync_marker TEXT NOT NULL DEFAULT \'\',created_at TEXT NOT NULL)').run();
  const id='e'.repeat(64),study=JSON.stringify(emptyStudy());
  await db.prepare('INSERT INTO accounts (id,login_id,password_hash,password_salt,recovery_hash,study,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,'legacy_login','existing-password-hash','existing-salt','old-code-hash',study,'2026-10-24T00:00:00Z').run();
  assert.equal((await api(transport(mf),'/api/account/session')).status,200);
  const row=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();assert.equal(row.recovery_hash,'');assert.equal(row.password_hash,'existing-password-hash');assert.equal(row.password_salt,'existing-salt');assert.equal(row.study,study);
  assert.equal((await api(transport(mf),'/api/account/recover','POST',{loginId:'legacy_login',recoveryCode:'a'.repeat(64),password})).status,410);
 }finally{await mf.dispose();}
});
test('permanent guest erasure blocks stale uploads and registration, clears local study data, and never automatically creates a replacement',async()=>{
 const mf=instance(),guest=device(mf),admin=transport(mf),anonymous=transport(mf);
 try{
  guest.tracker.answer(true);guest.tracker.answer(false);guest.tracker.flip();guest.personal.toggleFavorite('old-favorite');guest.raw.setItem('wordnest-theme','dark');await guest.ranking.join('Guest to erase');
  const prefs=guest.ranking.preferences(),id=prefs.id,payload={loginId:null,name:prefs.name,confirmation:id.slice(0,12)},path='/api/admin/rankings/'+id;
  const saved=Object.fromEntries(Array.from({length:guest.raw.length},(_,i)=>{const k=guest.raw.key(i);return [k,guest.raw.getItem(k)];}));
  assert.equal((await api(anonymous,path,'DELETE',payload)).status,401);await api(admin,'/api/login','POST',{password:'a-long-admin-password'});
  assert.equal((await api(admin,path,'DELETE',{...payload,confirmation:'wrong'})).data.error,'learnerConfirmIdentity');assert.equal((await api(admin,path,'DELETE',{...payload,name:'Stale name'})).status,409);assert.equal((await api(admin,path,'DELETE',payload,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await api(admin,path,'DELETE',payload)).status,200);
  for(const [endpoint,method,body] of [['/api/ranking/profile','GET',undefined],['/api/ranking/profile','POST',{revision:0,name:prefs.name,enabled:true,epoch:'',timezone:'UTC'}],['/api/ranking/stats','PUT',{revision:1,epoch:'',timezone:'UTC',days:{}}]])assert.equal((await api(anonymous,endpoint,method,body,{Authorization:'Bearer '+prefs.token})).status,410);
  await assert.rejects(guest.ranking.sync(true),/learnerErased/);assert.equal(guest.tracker.snapshot().answered,0);assert.equal(guest.tracker.snapshot().flips,0);assert.equal(guest.personal.favorite('old-favorite'),false);assert.equal(guest.ranking.preferences().erased,true);assert.equal(guest.ranking.preferences().name,undefined);assert.equal(guest.ranking.preferences().token,undefined);assert.equal(guest.raw.getItem('wordnest-theme'),'dark');
  const db=await mf.getD1Database('DB');for(let i=0;i<3;i++)await guest.ranking.sync(true);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ranking_profiles').first()).n,0);
  await assert.rejects(db.prepare('INSERT INTO ranking_profiles (id,name,timezone,updated_at) VALUES (?,?,?,?)').bind(id,'Stale request','UTC',new Date().toISOString()).run(),/learnerErased/,'database guards reject in-flight profile creation after erasure');
  const stale=device(mf);for(const [key,value] of Object.entries(saved))stale.raw.setItem(key,value);
  await assert.rejects(stale.account.register({loginId:'erased_guest_restore',password,name:'Guest to erase',enabled:true}),/accountGuestErased/);assert.equal(stale.tracker.snapshot().answered,0);assert.equal(stale.account.user,null);assert.equal(stale.account.guestProfile(),null);
  guest.tracker.answer(true);await guest.ranking.sync(true);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ranking_profiles').first()).n,0,'new practice remains local until explicit participation');
  await guest.ranking.join('New participation');assert.notEqual(guest.ranking.preferences().id,id);assert.equal((await guest.ranking.list('answered')).mine.value,1);
 }finally{await mf.dispose();}
});
test('permanent account erasure clears each device on reconnect instead of converting cached records into guests',async()=>{
 const mf=instance(),a=device(mf),b=device(mf),admin=transport(mf);
 try{
  a.tracker.answer(true);await a.ranking.join('Account to erase');const claimed=a.ranking.preferences();await a.account.register({loginId:'erase_everything',password,name:'Account to erase',enabled:false});await a.ranking.sync(true);const id=a.account.user.id;
  await b.account.login('erase_everything',password);await b.ranking.sync(true);b.connection.offline=true;b.tracker.answer(false);
  await api(admin,'/api/login','POST',{password:'a-long-admin-password'});const path='/api/admin/rankings/'+id;
  assert.equal((await api(admin,path,'DELETE',{name:'Account to erase',loginId:null,confirmation:'erase_everything'})).status,409);
  assert.equal((await api(admin,path,'DELETE',{name:'Account to erase',loginId:'erase_everything',confirmation:'erase_everything'})).status,200);
  await a.ranking.sync(true);assert.equal(a.account.user,null);assert.equal(a.tracker.snapshot().answered,0);assert.equal(a.ranking.preferences().erased,true);assert.equal(a.account.guestSuccessor(id).erased,true);assert.equal(a.account.guestProfile(),null);
  assert.equal(b.account.user.id,id);assert.equal(b.tracker.snapshot().answered,2);b.connection.offline=false;await b.account.initialize();assert.equal(b.account.user,null);assert.equal(b.tracker.snapshot().answered,0);assert.equal(b.account.pending().length,0);assert.equal(b.account.guestProfile(),null);
  const db=await mf.getD1Database('DB');for(const table of ['accounts','ranking_profiles','account_sessions','account_ops'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0,table);
  assert.equal((await api(transport(mf),'/api/ranking/profile','GET',undefined,{Authorization:'Bearer '+claimed.token})).data.error,'learnerErased');
  assert.equal((await api(transport(mf),'/api/account/session','GET',undefined,{'X-Wordnest-Account':id})).data.erasedAccountId,id);
 }finally{await mf.dispose();}
});
test('an erased guest cannot be imported into a different account and does not erase that account’s valid records',async()=>{
 const mf=instance(),a=device(mf),b=device(mf),admin=transport(mf);
 try{
  a.tracker.answer(true);await a.account.register({loginId:'keep_valid_account',password,name:'Keep me',enabled:false});b.tracker.answer(false);await b.ranking.join('Erased guest');const prefs=b.ranking.preferences();
  await api(admin,'/api/login','POST',{password:'a-long-admin-password'});assert.equal((await api(admin,'/api/admin/rankings/'+prefs.id,'DELETE',{name:prefs.name,loginId:null,confirmation:prefs.id.slice(0,12)})).status,200);
  await b.account.login('keep_valid_account',password);assert.equal(await b.account.importGuest(),false);assert.equal(b.account.user.id,a.account.user.id);assert.equal(b.tracker.snapshot().answered,1);assert.equal(b.tracker.snapshot().correct,1);assert.equal(b.account.pending().length,0);assert.equal(b.account.guestProfile(),null);await a.account.sync();assert.equal(a.tracker.snapshot().answered,1);
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
