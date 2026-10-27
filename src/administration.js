import {learnerSuspension,requireActiveLearner,rememberSession} from './management.js';
import {accountSession} from './accounts.js';
const encoder=new TextEncoder(),seconds=30*86400;
export const administratorSchema=[
 "CREATE TABLE IF NOT EXISTS administrator_identities (id TEXT PRIMARY KEY,profile_id TEXT,role TEXT NOT NULL CHECK(role IN ('admin','super')),revoked INTEGER NOT NULL DEFAULT 0,approved INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL)",
 'CREATE TABLE IF NOT EXISTS administrator_sessions (nonce TEXT PRIMARY KEY,identity_id TEXT NOT NULL,expires INTEGER NOT NULL,revision INTEGER NOT NULL,role TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS administrator_profile ON administrator_identities(profile_id)'
];
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const hex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const key=async password=>crypto.subtle.importKey('raw',await hash('wordnest-administrator-v2:'+password),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const passwordFor=(env,role)=>role==='super'?env.SUPER_ADMIN_PASSWORD:env.ADMIN_PASSWORD;
const valid=password=>typeof password==='string' && password.length>=12;
const token=request=>(request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('wordnest_session='))?.slice(17);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function administratorSession(request,env){
 try{
  const [expires,nonce,signature,extra]=(token(request)||'').split('.');
  if(extra || !/^\d+$/.test(expires) || !nonce || !signature || Number(expires)<=Date.now()/1000 || Number(expires)>Date.now()/1000+seconds+60)return null;
  const row=await env.DB.prepare('SELECT s.*,i.profile_id,i.revoked,i.approved,i.revision AS current_revision FROM administrator_sessions s JOIN administrator_identities i ON i.id=s.identity_id WHERE s.nonce=? AND s.expires=?').bind(nonce,Number(expires)).first();
  if(!row || !row.approved || row.revoked || row.revision!==row.current_revision || !valid(passwordFor(env,row.role)))return null;
  if(row.role!=='super' && row.profile_id && (await relatedAdministrators(env.DB,row.profile_id)).some(identity=>identity.revoked))return null;
  if(await learnerSuspension(env.DB,row.profile_id))return null;
  if(row.profile_id && await env.DB.prepare('SELECT profile_id FROM learner_deletions WHERE profile_id=?').bind(row.profile_id).first())return null;
  if(!await crypto.subtle.verify('HMAC',await key(passwordFor(env,row.role)),unb64(signature),encoder.encode(expires+'.'+nonce)))return null;
  await rememberSession(env.DB,request,'administrator',nonce,row.profile_id || row.identity_id);
  return {id:row.identity_id,role:row.role,profileId:row.profile_id};
 }catch{return null;}
}
export async function administratorLogin(request,env,data){
 if(valid(env.SUPER_ADMIN_PASSWORD) && env.SUPER_ADMIN_PASSWORD===env.ADMIN_PASSWORD)throw fail('adminPasswordConflict',503);
 const supplied=await hash(typeof data?.password==='string'?data.password:''),matches={};
 for(const role of ['admin','super']){const expected=await hash(passwordFor(env,role)||'');let difference=0;for(let i=0;i<supplied.length;i++)difference|=supplied[i]^expected[i];matches[role]=valid(passwordFor(env,role)) && difference===0;}
 const role=matches.super?'super':matches.admin?'admin':null;if(!role)throw fail('wrongPassword',401);
 let profileId=(await accountSession(request,env.DB))?.id || null;
 if(!profileId && data.guestToken!==undefined){
  if(typeof data.guestToken!=='string' || !/^[a-f0-9]{64}$/.test(data.guestToken))throw fail('adminIdentityRequired',400);
  profileId=hex(await hash(data.guestToken));
  if(!await env.DB.prepare('SELECT id FROM ranking_profiles WHERE id=? AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=?) AND NOT EXISTS(SELECT 1 FROM account_aliases WHERE profile_id=?)').bind(profileId,profileId,profileId).first())throw fail('adminIdentityRequired',409);
 }
 // Older API clients without learner credentials receive a separate anonymous identity.
 const oldNonce=token(request)?.split('.')[1],previous=oldNonce?await env.DB.prepare('SELECT identity_id FROM administrator_sessions WHERE nonce=?').bind(oldNonce).first():null;
 const id=profileId || previous?.identity_id || hex(await hash(crypto.randomUUID()));
 if(profileId && await env.DB.prepare('SELECT profile_id FROM learner_deletions WHERE profile_id=?').bind(profileId).first())throw fail('adminIdentityRequired',409);
 await requireActiveLearner(env.DB,profileId);
 const related=profileId?await relatedAdministrators(env.DB,profileId):[];
 if(role==='admin' && related.some(row=>row.revoked))throw fail('adminAccessRevoked');
 const row=await env.DB.prepare("INSERT INTO administrator_identities(id,profile_id,role,created_at,approved) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET approved=CASE WHEN excluded.role='super' THEN 1 ELSE administrator_identities.approved END,role=CASE WHEN excluded.role='super' THEN 'super' ELSE administrator_identities.role END,revoked=CASE WHEN excluded.role='super' THEN 0 ELSE administrator_identities.revoked END RETURNING *").bind(id,profileId,role,new Date().toISOString(),role==='super' || !valid(env.SUPER_ADMIN_PASSWORD)?1:0).first();
 if(row.revoked)throw fail('adminAccessRevoked');
 const expires=Math.floor(Date.now()/1000)+seconds,nonce=crypto.randomUUID();
 await env.DB.batch([env.DB.prepare('DELETE FROM administrator_sessions WHERE expires<=?').bind(Math.floor(Date.now()/1000)),env.DB.prepare('INSERT INTO administrator_sessions(nonce,identity_id,expires,revision,role) SELECT ?,id,?,revision,? FROM administrator_identities WHERE id=? AND revoked=0').bind(nonce,expires,role,id)]);
 const signature=b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(passwordFor(env,role)),encoder.encode(expires+'.'+nonce))));
 await rememberSession(env.DB,request,'administrator',nonce,profileId || id);
 return {token:expires+'.'+nonce+'.'+signature,id,role,pending:!row.approved};
}
export async function endAdministratorSession(request,db){const nonce=token(request)?.split('.')[1];if(nonce)await db.prepare('DELETE FROM administrator_sessions WHERE nonce=?').bind(nonce).run();}
export async function relatedAdministrators(db,profileId){
 return (await db.prepare(`SELECT * FROM administrator_identities WHERE profile_id=? OR profile_id IN (SELECT profile_id FROM account_aliases WHERE account_id=?) OR profile_id IN (SELECT account_id FROM account_aliases WHERE profile_id=?)`).bind(profileId,profileId,profileId).all()).results;
}
export async function protectAdministrator(db,actor,profileId){
 const related=await relatedAdministrators(db,profileId);
 if(related.some(row=>row.role==='super') || actor.role!=='super' && related.some(row=>!row.revoked && row.approved))throw fail('adminProtected');
}
export async function administratorApi(request,env,actor,readBody){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/admin/administrators' && request.method==='GET'){
  if(actor.role!=='super')throw fail('adminSuperRequired');
  const rows=await env.DB.prepare('SELECT i.id,i.profile_id AS profileId,i.role,i.revoked,i.approved,i.revision,COALESCE(p.name,c.name) AS name FROM administrator_identities i LEFT JOIN ranking_profiles p ON p.id=i.profile_id LEFT JOIN account_aliases a ON a.profile_id=i.profile_id LEFT JOIN ranking_profiles c ON c.id=a.account_id ORDER BY i.created_at DESC,i.id').all();return json({administrators:rows.results});
 }
 const match=path.match(/^\/api\/admin\/administrators\/([a-f0-9]{64})$/);
 if(match && request.method==='POST'){
  if(actor.role!=='super')throw fail('adminSuperRequired');
  const data=await readBody(request);if(!data || (typeof data.revoked!=='boolean' && data.approved!==true) || !Number.isSafeInteger(data.revision))throw fail('adminInvalidAction',400);
  const target=await env.DB.prepare('SELECT * FROM administrator_identities WHERE id=?').bind(match[1]).first();if(!target)return json({error:'notFound'},404);
  if(target.role==='super' || target.id===actor.id)throw fail('adminProtected');
  const family=target.profile_id?await relatedAdministrators(env.DB,target.profile_id):[target];
  if(family.some(row=>row.role==='super'))throw fail('adminProtected');
  const identities=JSON.stringify(family.map(row=>row.id)),revoked=data.approved===true?false:data.revoked;
  const rows=await env.DB.batch([
   env.DB.prepare("UPDATE administrator_identities SET approved=1,revoked=?,revision=revision+1 WHERE id=? AND role='admin' AND revision=? RETURNING id").bind(Number(revoked),target.id,data.revision),
   ...(revoked && target.approved?[env.DB.prepare(`INSERT INTO learner_messages(id,profile_id,message_ja,message_en,created_at,kind) SELECT ?,p.id,?,?,?,'admin-revoked' FROM ranking_profiles p WHERE (p.id=? OR p.id IN (SELECT account_id FROM account_aliases WHERE profile_id=?) OR p.id IN (SELECT profile_id FROM account_aliases WHERE account_id=?)) AND changes()=1 AND EXISTS(SELECT 1 FROM administrator_identities WHERE id=? AND revision=? AND revoked=1) ORDER BY EXISTS(SELECT 1 FROM accounts WHERE id=p.id) DESC LIMIT 1`).bind(crypto.randomUUID(), '管理者権限が剥奪されました。編集・管理機能は利用できません。学習記録は変更されません。権限の復帰については最高管理者にお問い合わせください。', 'Your administrator access has been revoked. Editing and administration are no longer available. Your learning records remain unchanged. Contact a super administrator about restoring access.', new Date().toISOString(),target.profile_id,target.profile_id,target.profile_id,target.id,data.revision+1)]:[]),
   env.DB.prepare('UPDATE administrator_identities SET approved=1,revoked=?,revision=revision+1 WHERE changes()>0 AND id<>? AND id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM administrator_identities WHERE id=? AND revision=?)').bind(Number(revoked),target.id,identities,target.id,data.revision+1)
   // Revision changes invalidate every related session. Retain old nonces until
   // expiry so legacy clients cannot renew a revoked identity under the same cookie.

  ]);
  if(!rows[0].results.length)throw fail('adminConflict',409);
  actor.auditAction=data.approved===true?'administrator.approve':revoked?'administrator.revoke':'administrator.restore';
  return json({ok:true});
 }
 return null;
}
