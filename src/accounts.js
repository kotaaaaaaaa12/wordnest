import { scryptAsync } from '@noble/hashes/scrypt.js';
import { rankingName } from '../public/rankings.js';
import { emptyStudy, importStudy, applyStudyOperation, accountStudySummary } from '../public/account-study.js';
const encoder=new TextEncoder(),SESSION_SECONDS=30*86400;
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const accountSchema=[
 'CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY,login_id TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,recovery_hash TEXT NOT NULL DEFAULT \'\',study TEXT NOT NULL,sync_revision INTEGER NOT NULL DEFAULT 0,sync_marker TEXT NOT NULL DEFAULT \'\',created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS account_sessions (hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires INTEGER NOT NULL,credential_hash TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id)',
 'CREATE TABLE IF NOT EXISTS account_aliases (profile_id TEXT PRIMARY KEY,account_id TEXT NOT NULL)',
 "CREATE TRIGGER IF NOT EXISTS account_claim_unique BEFORE INSERT ON accounts WHEN EXISTS(SELECT 1 FROM account_aliases WHERE profile_id=NEW.id) BEGIN SELECT RAISE(ABORT,'accountAlreadyLinked'); END",
 "CREATE TRIGGER IF NOT EXISTS account_alias_unique BEFORE INSERT ON account_aliases WHEN EXISTS(SELECT 1 FROM accounts WHERE id=NEW.profile_id AND id<>NEW.account_id) OR EXISTS(SELECT 1 FROM account_aliases WHERE profile_id=NEW.profile_id AND account_id<>NEW.account_id) BEGIN SELECT RAISE(ABORT,'accountAlreadyLinked'); END",
 'CREATE TABLE IF NOT EXISTS account_ops (account_id TEXT NOT NULL,op_id TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(account_id,op_id))'
];
const hex=bytes=>[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const tokenHash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
function equal(a,b){let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
function loginId(value){if(typeof value!=='string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value))throw fail('accountInvalidId');return value.toLowerCase();}
function password(value){if(typeof value!=='string' || [...value].length<15 || [...value].length>128)throw fail('accountInvalidPassword');return value;}
let hashQueue=Promise.resolve(),queuedHashes=0;
async function passwordHash(value,salt){
 if(queuedHashes>=4)throw fail('accountRateLimit',429);
 queuedHashes++;
 const work=hashQueue.catch(()=>{}).then(()=>scryptAsync(encoder.encode(value),encoder.encode(salt),{N:16384,r:8,p:5,dkLen:32,maxmem:32*1024*1024,asyncTick:10}));
 hashQueue=work;
 try{return hex(await work);}finally{queuedHashes--;}
}
function cookie(request,token='',age=SESSION_SECONDS){return `wordnest_account=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
function sessionToken(request){return (request.headers.get('Cookie') || '').split(';').map(value=>value.trim()).find(value=>value.startsWith('wordnest_account='))?.slice(17);}
export async function accountSession(request,db){
 const token=sessionToken(request);if(!token || !/^[a-f0-9]{64}$/.test(token))return null;
 return db.prepare('SELECT a.id,a.login_id FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires>? AND s.credential_hash=a.password_hash').bind(await tokenHash(token),Math.floor(Date.now()/1000)).first();
}
async function issueSession(request,db,id,expectedHash){
 const token=random(),now=Math.floor(Date.now()/1000);
 const result=await db.batch([db.prepare('DELETE FROM account_sessions WHERE expires<=?').bind(now),db.prepare('INSERT INTO account_sessions (hash,account_id,expires,credential_hash) SELECT ?,id,?,password_hash FROM accounts WHERE id=? AND password_hash=?').bind(await tokenHash(token),now+SESSION_SECONDS,id,expectedHash)]);
 if(!result[1].meta.changes)throw fail('accountWrongCredentials',401);
 return cookie(request,token);
}
async function rateLimit(request,db,purpose,id=''){
 const now=Math.floor(Date.now()/1000),bucket=Math.floor(now/900),ip=request.headers.get('CF-Connecting-IP') || 'local';
 const keys=[await tokenHash('account:'+purpose+':ip:'+ip+':'+bucket)];
 if(id)keys.push(await tokenHash('account:'+purpose+':id:'+id+':'+bucket));
 await db.prepare('DELETE FROM login_limits WHERE expires<?').bind(now).run();
 for(const key of keys){const row=await db.prepare('INSERT INTO login_limits (key,attempts,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+900).first();if(row.attempts>(purpose==='sync'?2000:purpose==='register'?10:20))throw fail('accountRateLimit',429);}
}
const user=row=>({id:row.id,loginId:row.login_id});
function zone(value){if(typeof value!=='string' || value.length>100)throw fail('accountInvalidData');try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();return value;}catch{throw fail('accountInvalidData');}}
function today(timezone){const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts();return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');}
function updateRanking(db,id,study,timezone,marker){
 const {days,summary:s}=accountStudySummary(study,today(timezone));
 return db.prepare(`UPDATE ranking_profiles SET days=?,timezone=?,total_ms=?,average_ms=?,answered=?,correct=?,accuracy=?,flips=?,streak=?,longest=?,last_study_day=?,epoch=?,revision=revision+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_marker=?)`).bind(JSON.stringify(days),timezone,s.totalMs,s.averageMs,s.answered,s.correct,s.accuracy,s.flips,s.streak,s.longest,s.lastStudyDay,'account:'+study.epochs.learning,new Date().toISOString(),id,id,marker);
}
export async function accountApi(request,db,readBody){
 const path=new URL(request.url).pathname,method=request.method;
 if(path==='/api/account/session' && method==='GET'){const session=await accountSession(request,db);return json({user:session?user(session):null});}
 if(path==='/api/account/recover')return json({error:'accountRecoveryDisabled'},410);
 if(method!=='POST')return json({error:'notFound'},404);
 const data=await readBody(request);if(!data || typeof data!=='object' || Array.isArray(data))throw fail('accountInvalidData');
 if(path==='/api/account/register'){
  const id=loginId(data.loginId);await rateLimit(request,db,'register',id);
  const supplied=password(data.password),name=rankingName(data.name),timezone=zone(data.timezone);
  if(typeof data.enabled!=='boolean')throw fail('accountInvalidData');
  let study;try{study=data.entries?importStudy(data.entries):emptyStudy();}catch{throw fail('accountInvalidData');}
  const legacy=typeof data.legacyToken==='string' && /^[a-f0-9]{64}$/.test(data.legacyToken)?await tokenHash(data.legacyToken):null;
  if(legacy && await db.prepare('SELECT account_id FROM account_aliases WHERE profile_id=?').bind(legacy).first())throw fail('accountAlreadyLinked',409);
  if(encoder.encode(JSON.stringify(study)).length>1800000)throw fail('accountDataTooLarge',413);
  const accountId=legacy || random(),salt=random(),hash=await passwordHash(supplied,salt);
  const now=new Date().toISOString(),marker=crypto.randomUUID();
  // Preserve an existing removal notice; account creation does not bypass moderation.
  const moderation=legacy?await db.prepare('SELECT active FROM ranking_moderation WHERE profile_id=? AND active=1').bind(legacy).first():null;
  try{
   await db.batch([
    db.prepare('INSERT INTO accounts (id,login_id,password_hash,password_salt,recovery_hash,study,sync_marker,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(accountId,id,hash,salt,'',JSON.stringify(study),marker,now),
    db.prepare('INSERT INTO ranking_profiles (id,name,enabled,epoch,timezone,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN ? THEN ranking_profiles.name ELSE excluded.name END,enabled=CASE WHEN ? THEN 0 ELSE excluded.enabled END,revision=ranking_profiles.revision+1').bind(accountId,name,moderation?0:Number(data.enabled),'account:'+study.epochs.learning,timezone,now,moderation?1:0,moderation?1:0),
    updateRanking(db,accountId,study,timezone,marker)
   ]);
  }catch(error){if(await db.prepare('SELECT id FROM accounts WHERE login_id=?').bind(id).first())throw fail('accountIdTaken',409);if(legacy && await db.prepare('SELECT id FROM accounts WHERE id=?').bind(legacy).first())throw fail('accountAlreadyLinked',409);throw error;}
  return json({user:{id:accountId,loginId:id},study},201,{'Set-Cookie':await issueSession(request,db,accountId,hash)});
 }
 if(path==='/api/account/login'){
  const id=loginId(data.loginId);await rateLimit(request,db,'login',id);
  const row=await db.prepare('SELECT * FROM accounts WHERE login_id=?').bind(id).first();
  const supplied=typeof data.password==='string' && data.password.length<=256?data.password:'';
  const hash=await passwordHash(supplied,row?.password_salt || 'wordnest-nonexistent-account');
  if(!row || !equal(hash,row.password_hash))throw fail('accountWrongCredentials',401);
  return json({user:user(row)},200,{'Set-Cookie':await issueSession(request,db,row.id,hash)});
 }
 const session=await accountSession(request,db);if(!session)throw fail('accountUnauthorized',401);
 if(path==='/api/account/logout'){
  await db.prepare('DELETE FROM account_sessions WHERE hash=?').bind(await tokenHash(sessionToken(request))).run();
  return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
 }
 if(path==='/api/account/password'){
  await rateLimit(request,db,'password',session.id);const next=password(data.password),row=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(session.id).first();
  if(!row)throw fail('accountUnauthorized',401);
  if(typeof data.currentPassword!=='string' || data.currentPassword.length>256 || !equal(await passwordHash(data.currentPassword,row.password_salt),row.password_hash))throw fail('accountWrongCredentials',401);
  const salt=random(),hash=await passwordHash(next,salt),marker=crypto.randomUUID();
  const result=await db.batch([
   db.prepare('UPDATE accounts SET password_hash=?,password_salt=?,recovery_hash=\'\',sync_marker=? WHERE id=? AND password_hash=? RETURNING id').bind(hash,salt,marker,row.id,row.password_hash),
   db.prepare('DELETE FROM account_sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_marker=?)').bind(row.id,row.id,marker)
  ]);
  if(!result[0].results.length)throw fail('accountConflict',409);
  return json({ok:true},200,{'Set-Cookie':await issueSession(request,db,row.id,hash)});
 }
 if(path==='/api/account/sync'){
  if(data.accountId!==session.id)throw fail('accountSessionChanged',409);
  await rateLimit(request,db,'sync',session.id);const timezone=zone(data.timezone);
  if(!Array.isArray(data.operations) || data.operations.length>50)throw fail('accountInvalidData');
  if(data.operations.some(op=>!op || typeof op.id!=='string' || !/^[a-zA-Z0-9-]{1,100}$/.test(op.id)))throw fail('accountInvalidData');
  const hashes=await Promise.all(data.operations.map(op=>tokenHash(JSON.stringify(op))));
  const legacyIds=await Promise.all(data.operations.filter(op=>op.type==='import' && typeof op.legacyToken==='string' && /^[a-f0-9]{64}$/.test(op.legacyToken)).map(op=>tokenHash(op.legacyToken)));
  for(const id of legacyIds){
   const owner=await db.prepare('SELECT id AS account_id FROM accounts WHERE id=? UNION ALL SELECT account_id FROM account_aliases WHERE profile_id=?').bind(id,id).first();
   if(owner && owner.account_id!==session.id)throw fail('accountAlreadyLinked',409);
  }
  for(let attempt=0;attempt<5;attempt++){
   const row=await db.prepare('SELECT study,sync_revision FROM accounts WHERE id=? AND password_hash=(SELECT credential_hash FROM account_sessions WHERE hash=?)').bind(session.id,await tokenHash(sessionToken(request))).first();
   if(!row)throw fail('accountUnauthorized',401);
   const study=JSON.parse(row.study);
   const known=data.operations.length?(await db.prepare('SELECT op_id,payload_hash FROM account_ops WHERE account_id=? AND op_id IN ('+data.operations.map(()=>'?').join(',')+')').bind(session.id,...data.operations.map(op=>op.id)).all()).results:[];
   const seen=new Map(known.map(op=>[op.op_id,op.payload_hash])),pending=[];
   for(const [index,op] of data.operations.entries()){
    if(seen.has(op.id)){if(seen.get(op.id)!==hashes[index])throw fail('accountInvalidData');continue;}
    applyStudyOperation(study,op);pending.push([op.id,hashes[index]]);seen.set(op.id,hashes[index]);
   }
   if(!pending.length)return json({user:user(session),study,revision:row.sync_revision,acknowledged:data.operations.map(op=>op.id)});
   const serialized=JSON.stringify(study);if(encoder.encode(serialized).length>1800000)throw fail('accountDataTooLarge',413);
   const marker=crypto.randomUUID(),results=await db.batch([
    db.prepare('UPDATE accounts SET study=?,sync_revision=sync_revision+1,sync_marker=? WHERE id=? AND sync_revision=? AND password_hash=(SELECT credential_hash FROM account_sessions WHERE hash=?) RETURNING sync_revision').bind(serialized,marker,session.id,row.sync_revision,await tokenHash(sessionToken(request))),
    ...pending.map(([id,hash])=>db.prepare('INSERT OR IGNORE INTO account_ops (account_id,op_id,payload_hash) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_marker=?)').bind(session.id,id,hash,session.id,marker)),
    updateRanking(db,session.id,study,timezone,marker),
    ...legacyIds.map(id=>db.prepare('INSERT OR IGNORE INTO account_aliases (profile_id,account_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_marker=?)').bind(id,session.id,session.id,marker)),
    ...legacyIds.map(id=>db.prepare('DELETE FROM ranking_profiles WHERE id=? AND id<>? AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=?) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_marker=?)').bind(id,session.id,id,session.id,marker))
   ]);
   if(results[0].results.length)return json({user:user(session),study,revision:results[0].results[0].sync_revision,acknowledged:data.operations.map(op=>op.id)});
  }
  throw fail('accountConflict',409);
 }
 return json({error:'notFound'},404);
}

// Called only after worker.js has authenticated the administrator.
export async function accountAdminApi(request,db,readBody){
 const path=new URL(request.url).pathname,match=path.match(/^\/api\/admin\/accounts\/([a-f0-9]{64})(\/password)?$/);
 if(!match || (match[2]?request.method!=='POST':request.method!=='DELETE'))return json({error:'notFound'},404);
 const data=await readBody(request),row=await db.prepare('SELECT id,login_id,password_hash FROM accounts WHERE id=?').bind(match[1]).first();
 if(!row)return json({error:'notFound'},404);
 if(!data || data.loginId!==row.login_id)throw fail('accountConfirmId');
 if(match[2]){
  const next=password(data.password);await rateLimit(request,db,'admin-password',row.id);
  const salt=random(),hash=await passwordHash(next,salt),marker=crypto.randomUUID();
  const results=await db.batch([
   db.prepare('UPDATE accounts SET password_hash=?,password_salt=?,recovery_hash=\'\',sync_marker=? WHERE id=? AND password_hash=? RETURNING id').bind(hash,salt,marker,row.id,row.password_hash),
   db.prepare('DELETE FROM account_sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_marker=?)').bind(row.id,row.id,marker)
  ]);
  if(!results[0].results.length)throw fail('accountConflict',409);
  return json({ok:true});
 }
 // Keep only anonymous credential tombstones so previously claimed guest
 // tokens cannot recreate a deleted account's ranking profile.
 const results=await db.batch([
  db.prepare('INSERT OR IGNORE INTO account_aliases (profile_id,account_id) SELECT id,id FROM accounts WHERE id=? AND password_hash=?').bind(row.id,row.password_hash),
  db.prepare('DELETE FROM accounts WHERE id=? AND password_hash=? RETURNING id').bind(row.id,row.password_hash),
  ...['account_sessions','account_ops'].map(table=>db.prepare(`DELETE FROM ${table} WHERE account_id=? AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=?)`).bind(row.id,row.id)),
  db.prepare('DELETE FROM ranking_moderation WHERE profile_id IN (SELECT profile_id FROM account_aliases WHERE account_id=?) AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=?)').bind(row.id,row.id),
  db.prepare('DELETE FROM ranking_profiles WHERE id IN (SELECT profile_id FROM account_aliases WHERE account_id=?) AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=?)').bind(row.id,row.id)
 ]);
 if(!results[1].results.length)throw fail('accountConflict',409);
 return json({ok:true});
}
