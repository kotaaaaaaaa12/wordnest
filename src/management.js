const encoder=new TextEncoder(),day=86400000;
export const managementSchema=[
 'CREATE TABLE IF NOT EXISTS management_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT,actor_role TEXT,action TEXT NOT NULL,target_id TEXT,created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS learner_messages (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,message_ja TEXT NOT NULL,message_en TEXT NOT NULL,created_at TEXT NOT NULL,acknowledged_at TEXT,kind TEXT NOT NULL DEFAULT \'message\')',
 'CREATE INDEX IF NOT EXISTS learner_message_owner ON learner_messages(profile_id,created_at)',
 'CREATE TABLE IF NOT EXISTS learner_removals (profile_id TEXT PRIMARY KEY,requested_at TEXT NOT NULL,delete_after TEXT NOT NULL,requested_by TEXT NOT NULL,nonce TEXT NOT NULL)',
 "CREATE TABLE IF NOT EXISTS managed_sessions (id TEXT PRIMARY KEY,kind TEXT NOT NULL,session_key TEXT NOT NULL,owner_id TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,last_seen TEXT NOT NULL,UNIQUE(kind,session_key))"
];
export const managementGuards=[
 "CREATE TRIGGER IF NOT EXISTS suspension_administrator_insert BEFORE INSERT ON administrator_identities WHEN EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=NEW.profile_id) BEGIN SELECT RAISE(ABORT,'learnerSuspended'); END",
 "CREATE TRIGGER IF NOT EXISTS suspension_administrator_role BEFORE UPDATE OF role ON administrator_identities WHEN EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=NEW.profile_id) BEGIN SELECT RAISE(ABORT,'learnerSuspended'); END",
 "CREATE TRIGGER IF NOT EXISTS suspension_account_insert BEFORE INSERT ON accounts WHEN EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=NEW.id) BEGIN SELECT RAISE(ABORT,'learnerSuspended'); END",
 "CREATE TRIGGER IF NOT EXISTS suspension_account_study BEFORE UPDATE OF study ON accounts WHEN EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=NEW.id) BEGIN SELECT RAISE(ABORT,'learnerSuspended'); END",
 "CREATE TRIGGER IF NOT EXISTS suspension_guest_import BEFORE INSERT ON account_aliases WHEN EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=NEW.profile_id) AND NOT EXISTS(SELECT 1 FROM learner_deletions WHERE profile_id=NEW.profile_id) BEGIN SELECT RAISE(ABORT,'learnerSuspended'); END",
 "CREATE TRIGGER IF NOT EXISTS suspension_ranking_write BEFORE UPDATE ON ranking_profiles WHEN EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=NEW.id) BEGIN SELECT RAISE(ABORT,'learnerSuspended'); END"
];
export const managementFail=(message,status=400)=>Object.assign(new Error(message),{status});
export const managementJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export const hashIdentity=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function cookieValue(request,name){return (request.headers.get('cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);}
export async function learnerIdentity(request,db){
 const cookie=cookieValue(request,'wordnest_account');
 if(cookie && /^[a-f0-9]{64}$/.test(cookie)){
  const row=await db.prepare('SELECT a.id FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=? AND s.expires>? AND s.credential_hash=a.password_hash').bind(await hashIdentity(cookie),Math.floor(Date.now()/1000)).first();if(row)return row.id;
 }
 const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return null;
 const id=await hashIdentity(token);
 if(await db.prepare('SELECT profile_id FROM learner_deletions WHERE profile_id=?').bind(id).first())throw managementFail('learnerErased',410);
 return (await db.prepare('SELECT id FROM ranking_profiles WHERE id=? AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=?) AND NOT EXISTS(SELECT 1 FROM account_aliases WHERE profile_id=?)').bind(id,id,id).first())?.id || null;
}
export async function learnerSuspension(db,id){
 if(!id)return null;
 return db.prepare('SELECT profile_id AS id,requested_at AS requestedAt,delete_after AS deleteAfter,nonce FROM learner_removals WHERE profile_id=? OR profile_id IN (SELECT account_id FROM account_aliases WHERE profile_id=?) OR profile_id IN (SELECT profile_id FROM account_aliases WHERE account_id=?) LIMIT 1').bind(id,id,id).first();
}
export async function requireActiveLearner(db,id){const row=await learnerSuspension(db,id);if(row)throw Object.assign(managementFail('learnerSuspended',423),{deleteAfter:row.deleteAfter});}
export async function audit(db,actor,action,target=null){await db.prepare('INSERT INTO management_audit(actor_id,actor_role,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(actor?.id || null,actor?.role || null,action,target,new Date().toISOString()).run();}
function deviceLabel(request){
 const ua=(request.headers.get('user-agent') || '').slice(0,512);
 const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'';
 const device=/iPad/.test(ua)?'iPad':/iPhone/.test(ua)?'iPhone':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'Mac':/Linux/.test(ua)?'Linux':'';
 return [browser,device].filter(Boolean).join(' · ');
}
export async function rememberSession(db,request,kind,key,owner){
 const now=new Date().toISOString(),threshold=new Date(Date.now()-300000).toISOString();
 await db.prepare('INSERT INTO managed_sessions(id,kind,session_key,owner_id,label,created_at,last_seen) VALUES (?,?,?,?,?,?,?) ON CONFLICT(kind,session_key) DO UPDATE SET last_seen=excluded.last_seen WHERE managed_sessions.last_seen<?').bind(crypto.randomUUID(),kind,key,owner,deviceLabel(request),now,now,threshold).run();
}
export async function listSessions(db,owner,request,includeAdmin=false){
 const accountKey=cookieValue(request,'wordnest_account'),currentAccount=accountKey?await hashIdentity(accountKey):'',currentAdmin=cookieValue(request,'wordnest_session')?.split('.')[1] || '';
 const account=(await db.prepare("SELECT m.id,m.kind,m.label,m.created_at AS createdAt,m.last_seen AS lastSeen,m.session_key FROM managed_sessions m JOIN account_sessions s ON m.session_key=s.hash JOIN accounts a ON a.id=s.account_id WHERE m.kind='account' AND m.owner_id=? AND s.expires>? AND s.credential_hash=a.password_hash ORDER BY m.last_seen DESC").bind(owner,Math.floor(Date.now()/1000)).all()).results;
 const admin=includeAdmin?(await db.prepare("SELECT m.id,m.kind,m.label,m.created_at AS createdAt,m.last_seen AS lastSeen,m.session_key FROM managed_sessions m JOIN administrator_sessions s ON m.session_key=s.nonce JOIN administrator_identities i ON i.id=s.identity_id WHERE m.kind='administrator' AND (i.profile_id=? OR i.profile_id IN (SELECT profile_id FROM account_aliases WHERE account_id=?)) AND s.expires>? AND i.revoked=0 AND i.approved=1 AND s.revision=i.revision ORDER BY m.last_seen DESC").bind(owner,owner,Math.floor(Date.now()/1000)).all()).results:[];
 return [...account,...admin].map(({session_key,...row})=>({...row,current:session_key===(row.kind==='account'?currentAccount:currentAdmin)}));
}
export async function revokeSessions(db,owner,request,{id,others=false,includeAdmin=false}={}){
 const rows=await listSessions(db,owner,request,includeAdmin),selected=rows.filter(row=>(!id || row.id===id) && (!others || !row.current));
 for(const row of selected){
  const table=row.kind==='account'?'account_sessions':'administrator_sessions',column=row.kind==='account'?'hash':'nonce';
  await db.batch([db.prepare(`DELETE FROM ${table} WHERE ${column}=(SELECT session_key FROM managed_sessions WHERE id=?)`).bind(row.id),db.prepare('DELETE FROM managed_sessions WHERE id=?').bind(row.id)]);
 }
 if(id && !selected.length)throw managementFail('managementConflict',409);
 return selected.length;
}
export async function finalizeRemovals(db){
 const now=new Date().toISOString(),due=(await db.prepare('SELECT * FROM learner_removals WHERE delete_after<=? ORDER BY delete_after LIMIT 10').bind(now).all()).results;
 for(const row of due){
  const marker=crypto.randomUUID(),id=row.profile_id,guard='EXISTS(SELECT 1 FROM learner_deletions WHERE profile_id=? AND marker=?)';
  const results=await db.batch([
   db.prepare('INSERT OR IGNORE INTO learner_deletions(profile_id,deleted_at,marker) SELECT id,?,? FROM ranking_profiles WHERE id=? AND EXISTS(SELECT 1 FROM learner_removals WHERE profile_id=? AND nonce=? AND delete_after<=?) RETURNING profile_id').bind(now,marker,id,id,row.nonce,now),
   db.prepare(`INSERT OR IGNORE INTO learner_deletions(profile_id,deleted_at,marker) SELECT profile_id,?,? FROM account_aliases WHERE account_id=? AND ${guard}`).bind(now,marker,id,id,marker),
   db.prepare(`INSERT OR IGNORE INTO account_aliases(profile_id,account_id) SELECT id,id FROM accounts WHERE id=? AND ${guard}`).bind(id,id,marker),
   ...['account_sessions','account_ops'].map(table=>db.prepare(`DELETE FROM ${table} WHERE account_id=? AND ${guard}`).bind(id,id,marker)),
   db.prepare(`DELETE FROM accounts WHERE id=? AND ${guard}`).bind(id,id,marker),
   db.prepare(`DELETE FROM administrator_sessions WHERE identity_id IN (SELECT id FROM administrator_identities WHERE profile_id IN (SELECT profile_id FROM learner_deletions WHERE marker=?)) AND ${guard}`).bind(marker,id,marker),
   db.prepare(`DELETE FROM administrator_identities WHERE profile_id IN (SELECT profile_id FROM learner_deletions WHERE marker=?) AND ${guard}`).bind(marker,id,marker),
   ...['ranking_moderation','learner_messages'].map(table=>db.prepare(`DELETE FROM ${table} WHERE profile_id IN (SELECT profile_id FROM learner_deletions WHERE marker=?) AND ${guard}`).bind(marker,id,marker)),
   db.prepare(`DELETE FROM managed_sessions WHERE owner_id IN (SELECT profile_id FROM learner_deletions WHERE marker=?) AND ${guard}`).bind(marker,id,marker),
   db.prepare(`DELETE FROM ranking_profiles WHERE id IN (SELECT profile_id FROM learner_deletions WHERE marker=?) AND ${guard}`).bind(marker,id,marker),
   db.prepare(`DELETE FROM learner_removals WHERE profile_id=? AND nonce=? AND ${guard}`).bind(id,row.nonce,id,marker),
   db.prepare(`INSERT INTO management_audit(actor_id,actor_role,action,target_id,created_at) SELECT NULL,'system','learner.finalized',?,? WHERE ${guard}`).bind(id,now,id,marker)
  ]);
  if(!results[0].results.length && !await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(id).first())await db.prepare('DELETE FROM learner_removals WHERE profile_id=? AND nonce=?').bind(id,row.nonce).run();
 }
}
export async function publicManagementApi(request,db,readBody,accountId){
 const path=new URL(request.url).pathname,method=request.method;
 if(!path.startsWith('/api/learner/') && !path.startsWith('/api/account/sessions'))return null;
 const id=accountId || await learnerIdentity(request,db);if(!id)return managementJson({error:'accountUnauthorized'},401);
 if(path==='/api/learner/status' && method==='GET')return managementJson({suspension:await learnerSuspension(db,id)});
 if(path.startsWith('/api/account/sessions')){
  if(!accountId)return managementJson({error:'accountUnauthorized'},401);
  if(path==='/api/account/sessions' && method==='GET')return managementJson({sessions:await listSessions(db,id,request)});
  if(path==='/api/account/sessions/others' && method==='POST'){return managementJson({ok:true,count:await revokeSessions(db,id,request,{others:true})});}
  const match=path.match(/^\/api\/account\/sessions\/([a-f0-9-]{36})$/);if(match && method==='DELETE')return managementJson({ok:true,count:await revokeSessions(db,id,request,{id:match[1]})});
  return managementJson({error:'notFound'},404);
 }
 if(path==='/api/learner/notifications' && method==='GET'){
  const rows=await db.prepare('SELECT id,kind,message_ja AS messageJa,message_en AS messageEn,created_at AS createdAt FROM learner_messages WHERE (profile_id=? OR profile_id IN (SELECT profile_id FROM account_aliases WHERE account_id=?)) AND acknowledged_at IS NULL ORDER BY created_at,id LIMIT 20').bind(id,id).all();return managementJson({notifications:rows.results});
 }
 const ack=path.match(/^\/api\/learner\/notifications\/([a-f0-9-]{36})\/ack$/);
 if(ack && method==='POST'){
  const result=await db.prepare('UPDATE learner_messages SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=? AND (profile_id=? OR profile_id IN (SELECT profile_id FROM account_aliases WHERE account_id=?)) RETURNING id').bind(new Date().toISOString(),ack[1],id,id).first();return result?managementJson({ok:true}):managementJson({error:'notFound'},404);
 }
 return managementJson({error:'notFound'},404);
}
export async function adminManagementApi(request,db,actor,readBody){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==='/api/admin/audit' && method==='GET'){
  if(actor.role!=='super')throw managementFail('adminSuperRequired',403);
  const before=Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before) || before<1)throw managementFail('managementInvalid');
  const result=await db.prepare('SELECT l.id,l.actor_id AS actorId,l.actor_role AS actorRole,l.action,l.target_id AS targetId,l.created_at AS createdAt,p.name AS actorName,t.name AS targetName FROM management_audit l LEFT JOIN administrator_identities i ON i.id=l.actor_id LEFT JOIN ranking_profiles p ON p.id=i.profile_id LEFT JOIN ranking_profiles t ON t.id=l.target_id WHERE l.id<? ORDER BY l.id DESC LIMIT 50').bind(before).all();return managementJson({entries:result.results,nextBefore:result.results.length===50?result.results.at(-1).id:null});
 }
 if(path==='/api/admin/deletions' && method==='GET'){
  if(actor.role!=='super')throw managementFail('adminSuperRequired',403);
  const result=await db.prepare('SELECT d.profile_id AS id,d.delete_after AS deleteAfter,d.nonce,p.name FROM learner_removals d JOIN ranking_profiles p ON p.id=d.profile_id ORDER BY d.delete_after LIMIT 200').all();return managementJson({deletions:result.results});
 }
 const cancel=path.match(/^\/api\/admin\/deletions\/([a-f0-9]{64})\/cancel$/);
 if(cancel && method==='POST'){
  if(actor.role!=='super')throw managementFail('adminSuperRequired',403);const data=await readBody(request);
  const result=await db.prepare('DELETE FROM learner_removals WHERE profile_id=? AND nonce=? AND delete_after>? RETURNING profile_id').bind(cancel[1],typeof data?.nonce==='string'?data.nonce:'',new Date().toISOString()).first();if(!result)throw managementFail('managementConflict',409);return managementJson({ok:true});
 }
 const target=path.match(/^\/api\/admin\/rankings\/([a-f0-9]{64})(?:\/(notifications|sessions))?$/);
 if(!target)return null;
 const id=target[1],kind=target[2],person=await db.prepare('SELECT p.name,a.login_id AS loginId FROM ranking_profiles p LEFT JOIN accounts a ON a.id=p.id WHERE p.id=?').bind(id).first();if(!person)return managementJson({error:'notFound'},404);
 if(!kind && method==='DELETE'){
  const data=await readBody(request);
  if(!data || data.confirmation!==(person.loginId || id.slice(0,12)))throw managementFail('learnerConfirmIdentity');
  if(data.name!==person.name || data.loginId!==person.loginId)throw managementFail('managementConflict',409);
  const now=new Date(),deleteAfter=new Date(now.getTime()+7*day).toISOString(),nonce=crypto.randomUUID();
  const row=await db.prepare('INSERT INTO learner_removals(profile_id,requested_at,delete_after,requested_by,nonce) SELECT p.id,?,?,?,? FROM ranking_profiles p LEFT JOIN accounts a ON a.id=p.id WHERE p.id=? AND p.name=? AND a.login_id IS ? ON CONFLICT(profile_id) DO NOTHING RETURNING delete_after AS deleteAfter').bind(now.toISOString(),deleteAfter,actor.id,nonce,id,person.name,person.loginId).first();
  if(!row)throw managementFail('managementConflict',409);return managementJson({ok:true,pendingDeletion:true,deleteAfter:row.deleteAfter});
 }
 if(kind==='sessions'){
  if(method==='GET')return managementJson({sessions:await listSessions(db,id,request,true)});
  if(method==='DELETE')return managementJson({ok:true,count:await revokeSessions(db,id,request,{includeAdmin:true})});
 }
 if(kind==='notifications'){
  if(method==='GET')return managementJson({notifications:(await db.prepare('SELECT id,kind,message_ja AS messageJa,message_en AS messageEn,created_at AS createdAt,acknowledged_at AS acknowledgedAt FROM learner_messages WHERE profile_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all()).results});
  if(method==='POST'){
   const data=await readBody(request),clean=value=>{if(value===undefined)return '';if(typeof value!=='string' || value.length>1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw managementFail('managementInvalid');return value.trim();};
   const ja=clean(data?.messageJa),en=clean(data?.messageEn);if(!ja && !en)throw managementFail('managementInvalid');
   const noteId=crypto.randomUUID();await db.prepare('INSERT INTO learner_messages(id,profile_id,message_ja,message_en,created_at) VALUES (?,?,?,?,?)').bind(noteId,id,ja,en,new Date().toISOString()).run();return managementJson({ok:true});
  }
 }
 return null;
}

export async function cleanupManagedSessions(db){
 await db.prepare("DELETE FROM managed_sessions WHERE (kind='account' AND NOT EXISTS(SELECT 1 FROM account_sessions s WHERE s.hash=managed_sessions.session_key AND s.expires>?)) OR (kind='administrator' AND NOT EXISTS(SELECT 1 FROM administrator_sessions s WHERE s.nonce=managed_sessions.session_key AND s.expires>?))").bind(Math.floor(Date.now()/1000),Math.floor(Date.now()/1000)).run();
}
