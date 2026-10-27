import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const origin='https://wordnest.example',admin='ordinary-administrator-password',superPassword='separate-super-administrator-password';
const instance=bindings=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:admin,SUPER_ADMIN_PASSWORD:superPassword,...bindings}}));
async function request(mf,path,method='GET',data,cookie,headers={}){const response=await mf.dispatchFetch(origin+path,{method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function guest(mf,letter,name){const token=letter.repeat(64),id=createHash('sha256').update(token).digest('hex'),db=await mf.getD1Database('DB');await request(mf,'/api/sets');await db.prepare('INSERT INTO ranking_profiles(id,name,enabled,epoch,timezone,updated_at) VALUES (?,?,0,?,?,?)').bind(id,name,'fixture','UTC',new Date().toISOString()).run();return {id,token};}
async function login(mf,password,guestToken,cookie){
 let result=await request(mf,'/api/login','POST',{password,...(guestToken?{guestToken}:{})},cookie);
 // These authorization tests model a previously approved administrator.
 if(result.data.pending){const db=await mf.getD1Database('DB');await db.prepare('UPDATE administrator_identities SET approved=1,revision=revision+1 WHERE id=?').bind(result.data.administratorId).run();result=await request(mf,'/api/login','POST',{password,...(guestToken?{guestToken}:{})},cookie);}
 return result;
}
test('guest administrator roles, protected super administrators, revocation, restoration, and session invalidation are enforced on the server',async()=>{
 const mf=instance();try{
  const a=await guest(mf,'a','Guest admin'),b=await guest(mf,'b','Guest owner');
  const owner=await login(mf,superPassword,b.token),first=await login(mf,admin,a.token),second=await login(mf,admin,a.token);
  assert.equal(owner.data.role,'super');assert.equal(first.data.role,'admin');assert.equal(first.data.administratorId,a.id);
  const list=await request(mf,'/api/admin/rankings',undefined,undefined,first.cookie);assert.equal(list.data.participants.find(row=>row.id===a.id).administratorRole,'admin');assert.equal(list.data.participants.find(row=>row.id===b.id).administratorRole,'super');
  assert.equal((await request(mf,'/api/admin/rankings/'+a.id+'/stats','GET',undefined,owner.cookie)).data.participant.administratorRole,'admin');
  assert.equal((await request(mf,'/api/admin/administrators','GET',undefined,first.cookie)).status,403);
  let roster=(await request(mf,'/api/admin/administrators','GET',undefined,owner.cookie)).data.administrators,entry=roster.find(row=>row.id===a.id);
  assert.equal((await request(mf,'/api/admin/administrators/'+a.id,'POST',{revoked:true,revision:entry.revision},first.cookie)).status,403);
  assert.equal((await request(mf,'/api/admin/administrators/'+a.id,'POST',{revoked:true,revision:entry.revision},owner.cookie,{Origin:'https://other.example'})).status,403);
  assert.equal((await request(mf,'/api/admin/rankings/'+b.id,'DELETE',{},first.cookie)).data.error,'adminProtected');
  assert.equal((await request(mf,'/api/admin/accounts/'+b.id+'/password','POST',{},first.cookie)).data.error,'adminProtected');
  assert.equal((await request(mf,'/api/admin/administrators/'+b.id,'POST',{revoked:true,revision:1},owner.cookie)).data.error,'adminProtected');
  assert.equal((await request(mf,'/api/admin/administrators/'+a.id,'POST',{revoked:true,revision:entry.revision},owner.cookie)).status,200);
  for(const cookie of [first.cookie,second.cookie]){assert.equal((await request(mf,'/api/session','GET',undefined,cookie)).data.authenticated,false);assert.equal((await request(mf,'/api/sets','POST',{},cookie)).status,401);}
  assert.equal((await login(mf,admin,a.token)).data.error,'adminAccessRevoked');assert.equal((await request(mf,'/api/session','GET',undefined,owner.cookie)).data.role,'super');
  assert.equal((await request(mf,'/api/admin/administrators/'+a.id,'POST',{revoked:false,revision:entry.revision},owner.cookie)).status,409);
  roster=(await request(mf,'/api/admin/administrators','GET',undefined,owner.cookie)).data.administrators;entry=roster.find(row=>row.id===a.id);
  assert.equal((await request(mf,'/api/admin/administrators/'+a.id,'POST',{revoked:false,revision:entry.revision},owner.cookie)).status,200);
  assert.equal((await request(mf,'/api/session','GET',undefined,first.cookie)).data.authenticated,false);
  const restored=await login(mf,admin,a.token);assert.equal(restored.status,200);
  await request(mf,'/api/logout','POST',{},restored.cookie);assert.equal((await request(mf,'/api/session','GET',undefined,restored.cookie)).data.authenticated,false);
  assert.equal((await request(mf,'/api/session','GET',undefined,owner.cookie+'tampered')).data.authenticated,false);
  const db=await mf.getD1Database('DB');assert.equal((await db.prepare('SELECT name FROM ranking_profiles WHERE id=?').bind(a.id).first()).name,'Guest admin');
  assert.equal(JSON.stringify((await request(mf,'/api/rankings')).data).includes('administratorRole'),false);
 }finally{await mf.dispose();}
});
test('learner identity proofs cannot be forged and matching role passwords are rejected',async()=>{
 const mf=instance();try{
  await request(mf,'/api/sets');assert.equal((await login(mf,admin,'c'.repeat(64))).data.error,'adminIdentityRequired');
  const g=await guest(mf,'d','Guest');const normal=await request(mf,'/api/login','POST',{password:admin,guestToken:g.token,role:'super',profileId:'f'.repeat(64)});assert.equal(normal.data.pending,true);assert.equal(normal.data.role,null);
  assert.equal((await login(mf,superPassword,g.token)).data.role,'super');
 }finally{await mf.dispose();}
 const conflict=instance({SUPER_ADMIN_PASSWORD:admin});try{assert.equal((await login(conflict,admin)).data.error,'adminPasswordConflict');}finally{await conflict.dispose();}
});
test('account sessions identify account administrators and guest aliases cannot bypass revocation',async()=>{
 const mf=instance();try{
  const ownerGuest=await guest(mf,'e','Owner'),owner=await login(mf,superPassword,ownerGuest.token);
  const old=await guest(mf,'f','Old guest'),oldAccess=await login(mf,admin,old.token);
  const registered=await request(mf,'/api/account/register','POST',{loginId:'admin_account',password:'a-learner-password-long-enough',name:'Account admin',enabled:false,timezone:'UTC'});assert.equal(registered.status,201);
  const id=registered.data.user.id,db=await mf.getD1Database('DB');await db.prepare('INSERT INTO account_aliases(profile_id,account_id) VALUES (?,?)').bind(old.id,id).run();
  const access=await login(mf,admin,undefined,registered.cookie);assert.equal(access.data.administratorId,id);
  const roster=(await request(mf,'/api/admin/administrators','GET',undefined,owner.cookie)).data.administrators,entry=roster.find(row=>row.id===old.id);
  await request(mf,'/api/admin/administrators/'+old.id,'POST',{revoked:true,revision:entry.revision},owner.cookie);
  assert.equal((await request(mf,'/api/session','GET',undefined,access.cookie)).data.authenticated,false);assert.equal((await login(mf,admin,undefined,registered.cookie)).data.error,'adminAccessRevoked');
  const updated=(await request(mf,'/api/admin/administrators','GET',undefined,owner.cookie)).data.administrators.find(row=>row.id===old.id);
  await request(mf,'/api/admin/administrators/'+old.id,'POST',{revoked:false,revision:updated.revision},owner.cookie);
  assert.equal((await request(mf,'/api/session','GET',undefined,oldAccess.cookie)).data.authenticated,false);assert.equal((await request(mf,'/api/session','GET',undefined,access.cookie)).data.authenticated,false);
 }finally{await mf.dispose();}
});
