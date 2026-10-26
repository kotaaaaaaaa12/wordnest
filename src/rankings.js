import { rankingNameKey } from '../public/rankings.js';
import { summarizeStudyDays } from '../public/stats.js';
const METRICS={totalMs:'total_ms',averageMs:'average_ms',answered:'answered',correct:'correct',accuracy:'accuracy',flips:'flips',streak:'streak',longest:'longest'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(key,status=400)=>Object.assign(new Error(key),{status});
export const rankingSchema=[
  `CREATE TABLE IF NOT EXISTS ranking_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, epoch TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL, days TEXT NOT NULL DEFAULT '{}', total_ms INTEGER NOT NULL DEFAULT 0, average_ms REAL NOT NULL DEFAULT 0, answered INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, accuracy REAL, flips INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, longest INTEGER NOT NULL DEFAULT 0, last_study_day TEXT, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ranking_moderation (profile_id TEXT PRIMARY KEY, notice_id TEXT NOT NULL, removed_name TEXT NOT NULL, removed_key TEXT NOT NULL, message_ja TEXT NOT NULL, message_en TEXT NOT NULL, removed_at TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`,
  'CREATE TABLE IF NOT EXISTS ranking_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)'
];
function dateInZone(timezone,now=Date.now()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
}
function validZone(value){if(typeof value!=='string' || value.length>100)throw fail('invalidRankingData');try{dateInZone(value);return value;}catch{throw fail('invalidRankingData');}}
function validEpoch(value){if(typeof value!=='string' || value.length>120 || /[\u0000-\u001f]/.test(value))throw fail('invalidRankingData');return value;}
function validName(value){if(typeof value!=='string')throw fail('invalidRankingName');const name=value.trim().normalize('NFC');if([...name].length<1 || [...name].length>20 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name))throw fail('invalidRankingName');return name;}
function validDays(value,today){
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length>20000)throw fail('invalidRankingData');
  const days={};
  for(const [key,day] of Object.entries(value)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key) || key<'2000-01-01' || key>today || (!Number.isFinite(Date.parse(key+'T00:00:00Z')) || new Date(key+'T00:00:00Z').toISOString().slice(0,10)!==key) || !day || typeof day!=='object')throw fail('invalidRankingData');
    if(!['ms','answered','correct','flips'].every(field=>Number.isSafeInteger(day[field]) && day[field]>=0) || day.ms>25*3600000 || day.answered>1000000 || day.flips>1000000 || day.correct>day.answered)throw fail('invalidRankingData');
    days[key]={ms:day.ms,answered:day.answered,correct:day.correct,flips:day.flips};
  }
  return days;
}
async function publicProfile(db,row){
  if(!row)return null;
  const moderation=await db.prepare('SELECT * FROM ranking_moderation WHERE profile_id=? AND active=1').bind(row.id).first();
  return {id:row.id,name:row.name,enabled:!!row.enabled,revision:row.revision,epoch:row.epoch,updatedAt:row.updated_at,notice:moderation?{id:moderation.notice_id,removedName:moderation.removed_name,ja:moderation.message_ja,en:moderation.message_en,removedAt:moderation.removed_at,acknowledged:!!moderation.acknowledged}:null};
}
async function identity(request){
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)throw fail('rankingUnauthorized',401);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function limit(db,request,id){
  const now=Math.floor(Date.now()/1000),bucket=Math.floor(now/60),address=request.headers.get('CF-Connecting-IP') || id;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(address));
  const key='ranking:'+bucket+':'+[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  await db.prepare('DELETE FROM ranking_limits WHERE expires<?').bind(now).run();
  const result=await db.prepare('INSERT INTO ranking_limits (key,attempts,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+120).first();
  if(result.attempts>120)throw fail('rankingRateLimit',429);
}
const emptyStats="days='{}',total_ms=0,average_ms=0,answered=0,correct=0,accuracy=NULL,flips=0,streak=0,longest=0,last_study_day=NULL";
async function leaderboard(db,url){
  const metric=url.searchParams.get('metric') || 'totalMs',column=METRICS[metric];if(!Object.hasOwn(METRICS,metric))throw fail('invalidRankingData');
  const self=url.searchParams.get('self') || '';if(self && !/^[a-f0-9]{64}$/.test(self))throw fail('invalidRankingData');
  let rows,mine,total;
  if(metric==='streak'){
    const result=await db.prepare('SELECT id,name,streak,last_study_day,timezone FROM ranking_profiles WHERE enabled=1 AND streak>0').all();
    const values=result.results.filter(row=>{const today=dateInZone(row.timezone);return row.last_study_day && (Date.parse(today)-Date.parse(row.last_study_day))/86400000<=1;}).sort((a,b)=>b.streak-a.streak || a.id.localeCompare(b.id));
    let last,rank=0;const ranked=values.map((row,index)=>{if(row.streak!==last)rank=index+1;last=row.streak;return {id:row.id,name:row.name,value:row.streak,rank};});
    rows=ranked.slice(0,100);mine=ranked.find(row=>row.id===self) || null;total=ranked.length;
  }else{
    const eligible=metric==='accuracy'?'answered>=30':`${column}>0`;
    const query=`WITH ranked AS (SELECT id,name,${column} AS value,RANK() OVER (ORDER BY ${column} DESC) AS rank FROM ranking_profiles WHERE enabled=1 AND ${eligible}) `;
    const results=await db.batch([
      db.prepare(query+'SELECT * FROM ranked ORDER BY value DESC,id LIMIT 100'),
      db.prepare(query+'SELECT * FROM ranked WHERE id=?').bind(self),
      db.prepare(`SELECT COUNT(*) AS total FROM ranking_profiles WHERE enabled=1 AND ${eligible}`)
    ]);
    rows=results[0].results;mine=results[1].results[0] || null;total=results[2].results[0].total;
  }
  return json({metric,rows,mine,total,minimumAnswers:metric==='accuracy'?30:0,updatedAt:new Date().toISOString()});
}
export async function rankingApi(request,db,readBody,accountId){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path==='/api/rankings' && method==='GET')return leaderboard(db,url);
  if(!['/api/ranking/profile','/api/ranking/stats','/api/ranking/notice'].includes(path))return json({error:'notFound'},404);
  if(accountId && request.headers.has('X-Wordnest-Account') && request.headers.get('X-Wordnest-Account')!==accountId)throw fail('rankingUnauthorized',401);
  const id=accountId || await identity(request);
  if(!accountId && await db.prepare('SELECT id FROM accounts WHERE id=? UNION ALL SELECT account_id AS id FROM account_aliases WHERE profile_id=?').bind(id,id).first())throw fail('rankingUnauthorized',401);
  if(path==='/api/ranking/profile' && method==='GET')return json({profile:await publicProfile(db,await db.prepare('SELECT * FROM ranking_profiles WHERE id=?').bind(id).first())});
  if(!['POST','PUT','DELETE'].includes(method))return json({error:'methodNotAllowed'},405);
  if(accountId && path==='/api/ranking/stats')return json({error:'accountStatsManaged'},409);
  await limit(db,request,id);
  const data=await readBody(request);if(!Number.isSafeInteger(data.revision) || data.revision<0)throw fail('invalidRankingData');
  const row=await db.prepare('SELECT * FROM ranking_profiles WHERE id=?').bind(id).first(),now=new Date().toISOString();
  if(path==='/api/ranking/notice' && method==='POST'){
    if(typeof data.noticeId!=='string' || data.noticeId.length>80)throw fail('invalidRankingData');
    const acknowledged=await db.prepare('UPDATE ranking_moderation SET acknowledged=1 WHERE profile_id=? AND notice_id=? AND active=1 RETURNING notice_id').bind(id,data.noticeId).first();
    if(!acknowledged)throw fail('rankingConflict',409);
    return json({profile:await publicProfile(db,await db.prepare('SELECT * FROM ranking_profiles WHERE id=?').bind(id).first())});
  }
  if(path==='/api/ranking/profile' && method==='POST'){
    const name=validName(data.name),epoch=accountId?row.epoch:validEpoch(data.epoch),timezone=validZone(data.timezone);if(typeof data.enabled!=='boolean')throw fail('invalidRankingData');
    let updated;
    if(!row){
      if(data.revision!==0)throw fail('rankingConflict',409);
      updated=await db.prepare('INSERT OR IGNORE INTO ranking_profiles (id,name,enabled,epoch,timezone,updated_at) VALUES (?,?,?,?,?,?) RETURNING *').bind(id,name,Number(data.enabled),epoch,timezone,now).first();
    }else{
      const moderation=await db.prepare('SELECT * FROM ranking_moderation WHERE profile_id=? AND active=1').bind(id).first();
      if(moderation && data.enabled){
        if(!moderation.acknowledged || data.noticeId!==moderation.notice_id)throw fail('rankingNoticeRequired',409);
        if(rankingNameKey(name)===moderation.removed_key)throw fail('rankingNameUnchanged',400);
      }
      const clear=row.epoch!==epoch;
      const statements=[db.prepare(`UPDATE ranking_profiles SET name=?,enabled=?,epoch=?,timezone=?,revision=revision+1,updated_at=?${clear?','+emptyStats:''} WHERE id=? AND revision=? RETURNING *`).bind(name,Number(data.enabled),epoch,timezone,now,id,data.revision)];
      if(moderation && data.enabled)statements.push(db.prepare('UPDATE ranking_moderation SET active=0 WHERE profile_id=? AND notice_id=? AND acknowledged=1 AND EXISTS(SELECT 1 FROM ranking_profiles WHERE id=? AND revision=? AND enabled=1 AND name=?)').bind(id,moderation.notice_id,id,data.revision+1,name));
      const results=await db.batch(statements);updated=results[0].results[0];
    }
    if(!updated)throw fail('rankingConflict',409);return json({profile:await publicProfile(db,updated)});
  }
  if(!row)throw fail('rankingDisabled',409);
  if(path==='/api/ranking/stats' && method==='DELETE'){
    const epoch=validEpoch(data.epoch);
    const updated=await db.prepare(`UPDATE ranking_profiles SET ${emptyStats},epoch=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING *`).bind(epoch,now,id,data.revision).first();
    if(!updated)throw fail('rankingConflict',409);return json({profile:await publicProfile(db,updated)});
  }
  if(path==='/api/ranking/stats' && method==='PUT'){
    const epoch=validEpoch(data.epoch),timezone=validZone(data.timezone),days=validDays(data.days,dateInZone(timezone)),summary=summarizeStudyDays(days,dateInZone(timezone));
    if(row.epoch!==epoch)throw fail('rankingConflict',409);
    const updated=await db.prepare(`UPDATE ranking_profiles SET days=?,timezone=?,total_ms=?,average_ms=?,answered=?,correct=?,accuracy=?,flips=?,streak=?,longest=?,last_study_day=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND epoch=? RETURNING *`).bind(JSON.stringify(days),timezone,summary.totalMs,summary.averageMs,summary.answered,summary.correct,summary.accuracy,summary.flips,summary.streak,summary.longest,summary.lastStudyDay,now,id,data.revision,epoch).first();
    if(!updated)throw fail('rankingConflict',409);return json({profile:await publicProfile(db,updated),summary});
  }
  return json({error:'methodNotAllowed'},405);
}

function moderationMessage(value){
  if(typeof value!=='string')throw fail('invalidRankingMessage');
  const message=value.replace(/\r\n?/g,'\n').trim();
  if([...message].length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(message))throw fail('invalidRankingMessage');
  return message;
}
export async function rankingAdminApi(request,db,readBody){
  const url=new URL(request.url),path=url.pathname;
  const statsMatch=path.match(/^\/api\/admin\/rankings\/([a-f0-9]{64})\/stats$/);
  if(statsMatch && request.method==='GET'){
    const row=await db.prepare('SELECT p.id,p.name,p.enabled,p.timezone,p.days,p.updated_at,a.login_id AS loginId,a.created_at AS accountCreatedAt FROM ranking_profiles p LEFT JOIN accounts a ON a.id=p.id WHERE p.id=?').bind(statsMatch[1]).first();
    if(!row)return json({error:'notFound'},404);
    // Recalculate streaks in the participant's timezone, including days without uploads.
    const days=JSON.parse(row.days),today=dateInZone(row.timezone),summary=summarizeStudyDays(days,today);
    return json({days,today,participant:{id:row.id,name:row.name,enabled:Boolean(row.enabled),timezone:row.timezone,updatedAt:row.updated_at,loginId:row.loginId,accountCreatedAt:row.accountCreatedAt},summary});
  }
  if(path==='/api/admin/rankings' && request.method==='GET'){
    const status=url.searchParams.get('status') || 'all',kind=url.searchParams.get('kind') || 'all',q=(url.searchParams.get('q') || '').trim(),offset=Number(url.searchParams.get('offset') || 0);
    if(!['all','listed','private','removed'].includes(status) || !['all','accounts','guests'].includes(kind) || q.length>100 || !Number.isSafeInteger(offset) || offset<0 || offset>1000000)throw fail('invalidRankingData');
    const filter={all:'1=1',listed:'p.enabled=1 AND COALESCE(m.active,0)=0',private:'p.enabled=0 AND COALESCE(m.active,0)=0',removed:'m.active=1'}[status];
    const kindFilter={all:'1=1',accounts:'a.id IS NOT NULL',guests:'a.id IS NULL'}[kind];
    const base=`FROM ranking_profiles p LEFT JOIN ranking_moderation m ON m.profile_id=p.id LEFT JOIN accounts a ON a.id=p.id WHERE (${filter}) AND (${kindFilter}) AND (instr(lower(p.name),lower(?))>0 OR instr(lower(COALESCE(a.login_id,'')),lower(?))>0)`;
    const result=await db.batch([db.prepare(`SELECT p.id,p.name,p.revision,p.enabled,a.login_id AS loginId,a.created_at AS accountCreatedAt,COALESCE(m.active,0) AS removed,p.updated_at AS updatedAt,m.notice_id AS noticeId,m.removed_at AS removedAt,m.message_ja AS messageJa,m.message_en AS messageEn,m.acknowledged ${base} ORDER BY p.updated_at DESC,p.id LIMIT 50 OFFSET ?`).bind(q,q,offset),db.prepare(`SELECT COUNT(*) AS total ${base}`).bind(q,q)]);
    return json({participants:result[0].results,total:result[1].results[0].total,offset});
  }
  const match=path.match(/^\/api\/admin\/rankings\/([a-f0-9]{64})\/remove$/);
  if(match && request.method==='POST'){
    const data=await readBody(request),messageJa=moderationMessage(data.messageJa),messageEn=moderationMessage(data.messageEn);
    if(!messageJa && !messageEn)throw fail('invalidRankingMessage');
    if(!Number.isSafeInteger(data.revision) || data.revision<1)throw fail('invalidRankingData');
    const row=await db.prepare('SELECT * FROM ranking_profiles WHERE id=?').bind(match[1]).first();
    if(!row || !row.enabled || (typeof data.name==='string'?row.name!==data.name:row.revision!==data.revision))throw fail('rankingConflict',409);
    // Ordinary study uploads may advance the revision while an administrator writes a notice.
    const condition=typeof data.name==='string'?'name=?':'revision=?',expected=typeof data.name==='string'?data.name:data.revision;
    const noticeId=crypto.randomUUID(),now=new Date().toISOString();
    const result=await db.batch([
      db.prepare(`INSERT INTO ranking_moderation (profile_id,notice_id,removed_name,removed_key,message_ja,message_en,removed_at,acknowledged,active) SELECT id,?,?,?,?,?,?,0,1 FROM ranking_profiles WHERE id=? AND ${condition} AND enabled=1 ON CONFLICT(profile_id) DO UPDATE SET notice_id=excluded.notice_id,removed_name=excluded.removed_name,removed_key=excluded.removed_key,message_ja=excluded.message_ja,message_en=excluded.message_en,removed_at=excluded.removed_at,acknowledged=0,active=1`).bind(noticeId,row.name,rankingNameKey(row.name),messageJa,messageEn,now,row.id,expected),
      db.prepare(`UPDATE ranking_profiles SET enabled=0,revision=revision+1,updated_at=? WHERE id=? AND ${condition} AND enabled=1 AND EXISTS(SELECT 1 FROM ranking_moderation WHERE profile_id=? AND notice_id=?) RETURNING id`).bind(now,row.id,expected,row.id,noticeId)
    ]);
    if(!result[1].results.length)throw fail('rankingConflict',409);
    return json({ok:true,noticeId});
  }
  return json({error:'notFound'},404);
}
