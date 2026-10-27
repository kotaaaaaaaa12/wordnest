import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {finalizeRemovals} from '../src/management.js';
const built=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}),origin='https://wordnest.example',normal='normal-administrator-password',highest='highest-administrator-password';
const instance=()=>new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:normal,SUPER_ADMIN_PASSWORD:highest}}));
async function req(mf,path,method='GET',data,cookie,token,headers={}){const response=await mf.dispatchFetch(origin+path,{method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function guest(mf,letter,name){await req(mf,'/api/sets');const token=letter.repeat(64),id=createHash('sha256').update(token).digest('hex'),db=await mf.getD1Database('DB');await db.prepare('INSERT INTO ranking_profiles(id,name,enabled,epoch,timezone,updated_at,total_ms,answered,correct) VALUES (?,?,1,?,?,?,60000,2,1)').bind(id,name,'guest-fixture','UTC',new Date().toISOString()).run();return {id,token};}
async function owner(mf){const g=await guest(mf,'a','Owner'),access=await req(mf,'/api/login','POST',{password:highest,guestToken:g.token});assert.equal(access.status,200);return {...g,cookie:access.cookie};}
async function approved(mf,root,g){let login=await req(mf,'/api/login','POST',{password:normal,guestToken:g.token});const list=await req(mf,'/api/admin/administrators','GET',undefined,root.cookie),entry=list.data.administrators.find(p=>p.id===g.id);if(!entry.approved)await req(mf,'/api/admin/administrators/'+g.id,'POST',{approved:true,revision:entry.revision},root.cookie);login=await req(mf,'/api/login','POST',{password:normal,guestToken:g.token});return login;}
test('new administrator identities require approval; pending cookies and fresh guest IDs cannot bypass it; audit excludes secrets',async()=>{
 const mf=instance();try{
  const root=await owner(mf),g=await guest(mf,'b','Applicant'),pending=await req(mf,'/api/login','POST',{password:normal,guestToken:g.token});assert.equal(pending.data.pending,true);assert.equal((await req(mf,'/api/session','GET',undefined,pending.cookie)).data.authenticated,false);assert.equal((await req(mf,'/api/sets','POST',{},pending.cookie)).status,401);
  assert.equal((await req(mf,'/api/admin/audit','GET',undefined,pending.cookie)).status,401);
  const current=await approved(mf,root,g);assert.equal(current.data.pending,false);assert.equal((await req(mf,'/api/session','GET',undefined,pending.cookie)).data.authenticated,false,'approval requires a new administrator sign-in');assert.equal((await req(mf,'/api/session','GET',undefined,current.cookie)).data.authenticated,true);assert.equal((await req(mf,'/api/admin/audit','GET',undefined,current.cookie)).status,403);
  const different=await guest(mf,'c','New identity');assert.equal((await req(mf,'/api/login','POST',{password:normal,guestToken:different.token})).data.pending,true);
  const grant=(await req(mf,'/api/admin/administrators','GET',undefined,root.cookie)).data.administrators.find(row=>row.id===g.id);
  assert.equal((await req(mf,'/api/admin/administrators/'+g.id,'POST',{revoked:true,revision:grant.revision},root.cookie)).status,200);
  const notice=(await req(mf,'/api/learner/notifications','GET',undefined,undefined,g.token)).data.notifications.find(note=>note.kind==='admin-revoked');assert.ok(notice);assert.match(notice.messageEn,/revoked/);assert.match(notice.messageJa,/剥奪/);
  assert.ok((await req(mf,'/api/learner/notifications','GET',undefined,undefined,g.token)).data.notifications.some(note=>note.id===notice.id),'reconnecting without acknowledgement retains the notice');
  assert.equal((await req(mf,'/api/admin/administrators/'+g.id,'POST',{revoked:true,revision:grant.revision},root.cookie)).status,409);
  assert.equal((await req(mf,'/api/learner/notifications','GET',undefined,undefined,g.token)).data.notifications.filter(note=>note.kind==='admin-revoked').length,1,'stale revocations cannot enqueue duplicates');
  await req(mf,'/api/learner/notifications/'+notice.id+'/ack','POST',{},undefined,g.token);assert.equal((await req(mf,'/api/learner/notifications','GET',undefined,undefined,g.token)).data.notifications.some(note=>note.id===notice.id),false);
  const log=(await req(mf,'/api/admin/audit','GET',undefined,root.cookie)).data.entries;assert.ok(log.some(e=>e.action==='administrator.request'));assert.ok(log.some(e=>e.action==='administrator.approve'));assert.ok(!JSON.stringify(log).includes(normal));assert.ok(!JSON.stringify(log).includes(g.token));
 }finally{await mf.dispose();}
});
test('notifications are private, acknowledge only their owner, preserve plain text, and remain separate from ranking moderation',async()=>{
 const mf=instance();try{
  const root=await owner(mf),g=await guest(mf,'b','Recipient'),other=await guest(mf,'c','Other');
  const path='/api/admin/rankings/'+g.id+'/notifications';assert.equal((await req(mf,path,'POST',{messageJa:'<script>お知らせ</script>\n確認してください。'},root.cookie)).status,200);
  const notes=(await req(mf,'/api/learner/notifications','GET',undefined,undefined,g.token)).data.notifications;assert.equal(notes.length,1);assert.equal(notes[0].messageJa,'<script>お知らせ</script>\n確認してください。');
  assert.equal((await req(mf,'/api/learner/notifications','GET',undefined,undefined,other.token)).data.notifications.length,0);assert.equal((await req(mf,'/api/learner/notifications/'+notes[0].id+'/ack','POST',{},undefined,other.token)).status,404);
  await req(mf,'/api/learner/notifications/'+notes[0].id+'/ack','POST',{},undefined,g.token);assert.equal((await req(mf,'/api/learner/notifications','GET',undefined,undefined,g.token)).data.notifications.length,0);assert.ok((await req(mf,path,'GET',undefined,root.cookie)).data.notifications[0].acknowledgedAt);
  assert.equal((await req(mf,path,'POST',{messageEn:'x'.repeat(1001)},root.cookie)).status,400);
 }finally{await mf.dispose();}
});
test('seven-day deletion suspends without erasing records, cancellation restores listing, and only due deletion removes identities',async()=>{
 const mf=instance();try{
  const root=await owner(mf),g=await guest(mf,'b','Learner'),staff=await guest(mf,'c','Staff'),access=await approved(mf,root,staff),db=await mf.getD1Database('DB'),path='/api/admin/rankings/'+g.id;
  const schedule=()=>req(mf,path,'DELETE',{name:'Learner',loginId:null,confirmation:g.id.slice(0,12)},root.cookie);
  let result=await schedule();assert.equal(result.status,200);assert.equal(result.data.pendingDeletion,true);assert.ok(Date.parse(result.data.deleteAfter)-Date.now()>6.99*86400000);
  assert.ok(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(g.id).first());assert.equal(await db.prepare('SELECT profile_id FROM learner_deletions WHERE profile_id=?').bind(g.id).first(),null);
  assert.ok((await req(mf,'/api/learner/status','GET',undefined,undefined,g.token)).data.suspension);assert.equal((await req(mf,'/api/ranking/stats','PUT',{},undefined,g.token)).status,423);await assert.rejects(db.prepare('UPDATE ranking_profiles SET answered=999 WHERE id=?').bind(g.id).run(),/learnerSuspended/);await assert.rejects(db.prepare('INSERT INTO account_aliases(profile_id,account_id) VALUES (?,?)').bind(g.id,staff.id).run(),/learnerSuspended/);
  assert.equal((await req(mf,'/api/rankings?metric=answered')).data.rows.some(row=>row.id===g.id),false);
  let entry=(await req(mf,'/api/admin/deletions','GET',undefined,root.cookie)).data.deletions.find(row=>row.id===g.id);assert.equal((await req(mf,'/api/admin/deletions/'+g.id+'/cancel','POST',{nonce:entry.nonce},access.cookie)).status,403);
  assert.equal((await req(mf,'/api/admin/deletions/'+g.id+'/cancel','POST',{nonce:'stale'},root.cookie)).status,409);assert.equal((await req(mf,'/api/admin/deletions/'+g.id+'/cancel','POST',{nonce:entry.nonce},root.cookie)).status,200);
  assert.equal((await req(mf,'/api/learner/status','GET',undefined,undefined,g.token)).data.suspension,null);assert.ok((await req(mf,'/api/rankings?metric=answered')).data.rows.some(row=>row.id===g.id));
  await schedule();await finalizeRemovals(db);assert.ok(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(g.id).first());
  await db.prepare('UPDATE learner_removals SET delete_after=? WHERE profile_id=?').bind(new Date(Date.now()-1).toISOString(),g.id).run();await finalizeRemovals(db);
  assert.equal(await db.prepare('SELECT id FROM ranking_profiles WHERE id=?').bind(g.id).first(),null);assert.ok(await db.prepare('SELECT profile_id FROM learner_deletions WHERE profile_id=?').bind(g.id).first());assert.equal((await req(mf,'/api/learner/status','GET',undefined,undefined,g.token)).status,410);
  assert.ok((await req(mf,'/api/admin/audit','GET',undefined,root.cookie)).data.entries.some(row=>row.action==='learner.finalized'));
 }finally{await mf.dispose();}
});
test('account device sessions are isolated; signing out other devices retains the current session; administrators can sign all out',async()=>{
 const mf=instance();try{
  const root=await owner(mf),register=await req(mf,'/api/account/register','POST',{loginId:'devices',password:'learner-password-long-enough',name:'Devices',enabled:true,timezone:'UTC'},undefined,undefined,{'User-Agent':'Mozilla/5.0 (iPhone) AppleWebKit Safari/605.1'});assert.equal(register.status,201);
  const second=await req(mf,'/api/account/login','POST',{loginId:'devices',password:'learner-password-long-enough'},undefined,undefined,{'User-Agent':'Mozilla/5.0 (Windows) Chrome/120.0'});
  let sessions=(await req(mf,'/api/account/sessions','GET',undefined,register.cookie)).data.sessions;assert.equal(sessions.length,2);assert.equal(sessions.filter(s=>s.current).length,1);assert.ok(sessions.some(s=>s.label==='Safari · iPhone'));assert.ok(!JSON.stringify(sessions).includes('wordnest_account'));
  const other=await req(mf,'/api/account/register','POST',{loginId:'unrelated',password:'different-long-password-value',name:'Other',enabled:false,timezone:'UTC'});assert.equal((await req(mf,'/api/account/sessions/'+sessions.find(s=>!s.current).id,'DELETE',undefined,other.cookie)).status,409);
  await req(mf,'/api/account/sessions/others','POST',{},register.cookie);assert.equal((await req(mf,'/api/account/session','GET',undefined,second.cookie)).data.user,null);assert.ok((await req(mf,'/api/account/session','GET',undefined,register.cookie)).data.user);
  await req(mf,'/api/admin/rankings/'+register.data.user.id+'/sessions','DELETE',undefined,root.cookie);assert.equal((await req(mf,'/api/account/session','GET',undefined,register.cookie)).data.user,null);
 }finally{await mf.dispose();}
});

test('upgrading the administrator schema preserves existing approved access; new identities still need approval',async()=>{
 const mf=instance();try{
  const db=await mf.getD1Database('DB'),id='e'.repeat(64),nonce=crypto.randomUUID(),expires=Math.floor(Date.now()/1000)+3600;
  await db.prepare('CREATE TABLE administrator_identities(id TEXT PRIMARY KEY,profile_id TEXT,role TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL)').run();
  await db.prepare('CREATE TABLE administrator_sessions(nonce TEXT PRIMARY KEY,identity_id TEXT NOT NULL,expires INTEGER NOT NULL,revision INTEGER NOT NULL,role TEXT NOT NULL)').run();
  await db.prepare("INSERT INTO administrator_identities(id,role,created_at) VALUES (?,'admin',?)").bind(id,new Date().toISOString()).run();await db.prepare("INSERT INTO administrator_sessions VALUES (?,?,?,1,'admin')").bind(nonce,id,expires).run();
  const signature=createHmac('sha256',createHash('sha256').update('wordnest-administrator-v2:'+normal).digest()).update(expires+'.'+nonce).digest('base64url');
  const session=await req(mf,'/api/session','GET',undefined,'wordnest_session='+expires+'.'+nonce+'.'+signature);assert.equal(session.data.authenticated,true);assert.equal((await db.prepare('SELECT approved FROM administrator_identities WHERE id=?').bind(id).first()).approved,1);
  const g=await guest(mf,'f','New applicant');assert.equal((await req(mf,'/api/login','POST',{password:normal,guestToken:g.token})).data.pending,true);
 }finally{await mf.dispose();}
});
test('audit pagination stays private and stable while newer operations are added',async()=>{
 const mf=instance();try{
  const root=await owner(mf),db=await mf.getD1Database('DB');await db.batch(Array.from({length:55},()=>db.prepare("INSERT INTO management_audit(actor_id,actor_role,action,created_at) VALUES (?,'super','sets.update',?)").bind(root.id,new Date().toISOString())));
  const first=(await req(mf,'/api/admin/audit','GET',undefined,root.cookie)).data;assert.equal(first.entries.length,50);assert.ok(first.nextBefore);await db.prepare("INSERT INTO management_audit(actor_role,action,created_at) VALUES ('system','learner.finalized',?)").bind(new Date().toISOString()).run();
  const second=(await req(mf,'/api/admin/audit?before='+first.nextBefore,'GET',undefined,root.cookie)).data;assert.ok(second.entries.length>0);assert.equal(new Set([...first.entries,...second.entries].map(row=>row.id)).size,first.entries.length+second.entries.length);assert.equal((await req(mf,'/api/admin/audit?before=-1','GET',undefined,root.cookie)).status,400);
 }finally{await mf.dispose();}
});
