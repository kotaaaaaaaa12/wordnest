import { summarizeStudyDays } from '../public/stats.js';
const METRICS={totalMs:'total_ms',averageMs:'average_ms',answered:'answered',correct:'correct',accuracy:'accuracy',flips:'flips',streak:'streak',longest:'longest'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(key,status=400)=>Object.assign(new Error(key),{status});
export const rankingSchema=[
  `CREATE TABLE IF NOT EXISTS ranking_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, epoch TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL, days TEXT NOT NULL DEFAULT '{}', total_ms INTEGER NOT NULL DEFAULT 0, average_ms REAL NOT NULL DEFAULT 0, answered INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, accuracy REAL, flips INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, longest INTEGER NOT NULL DEFAULT 0, last_study_day TEXT, updated_at TEXT NOT NULL)`,
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
function publicProfile(row){return row?{id:row.id,name:row.name,enabled:!!row.enabled,revision:row.revision,epoch:row.epoch,updatedAt:row.updated_at}:null;}
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
export async function rankingApi(request,db,readBody){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path==='/api/rankings' && method==='GET')return leaderboard(db,url);
  if(!['/api/ranking/profile','/api/ranking/stats'].includes(path))return json({error:'notFound'},404);
  const id=await identity(request);
  if(path==='/api/ranking/profile' && method==='GET')return json({profile:publicProfile(await db.prepare('SELECT * FROM ranking_profiles WHERE id=?').bind(id).first())});
  if(!['POST','PUT','DELETE'].includes(method))return json({error:'methodNotAllowed'},405);
  await limit(db,request,id);
  const data=await readBody(request);if(!Number.isSafeInteger(data.revision) || data.revision<0)throw fail('invalidRankingData');
  const row=await db.prepare('SELECT * FROM ranking_profiles WHERE id=?').bind(id).first(),now=new Date().toISOString();
  if(path==='/api/ranking/profile' && method==='POST'){
    const name=validName(data.name),epoch=validEpoch(data.epoch),timezone=validZone(data.timezone);if(typeof data.enabled!=='boolean')throw fail('invalidRankingData');
    let updated;
    if(!row){
      if(data.revision!==0)throw fail('rankingConflict',409);
      updated=await db.prepare('INSERT OR IGNORE INTO ranking_profiles (id,name,enabled,epoch,timezone,updated_at) VALUES (?,?,?,?,?,?) RETURNING *').bind(id,name,Number(data.enabled),epoch,timezone,now).first();
    }else{
      const clear=!data.enabled || row.epoch!==epoch;
      updated=await db.prepare(`UPDATE ranking_profiles SET name=?,enabled=?,epoch=?,timezone=?,revision=revision+1,updated_at=?${clear?','+emptyStats:''} WHERE id=? AND revision=? RETURNING *`).bind(name,Number(data.enabled),epoch,timezone,now,id,data.revision).first();
    }
    if(!updated)throw fail('rankingConflict',409);return json({profile:publicProfile(updated)});
  }
  if(!row || !row.enabled)throw fail('rankingDisabled',409);
  if(path==='/api/ranking/stats' && method==='DELETE'){
    const epoch=validEpoch(data.epoch);
    const updated=await db.prepare(`UPDATE ranking_profiles SET ${emptyStats},epoch=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND enabled=1 RETURNING *`).bind(epoch,now,id,data.revision).first();
    if(!updated)throw fail('rankingConflict',409);return json({profile:publicProfile(updated)});
  }
  if(path==='/api/ranking/stats' && method==='PUT'){
    const epoch=validEpoch(data.epoch),timezone=validZone(data.timezone),days=validDays(data.days,dateInZone(timezone)),summary=summarizeStudyDays(days,dateInZone(timezone));
    if(row.epoch!==epoch)throw fail('rankingConflict',409);
    const updated=await db.prepare(`UPDATE ranking_profiles SET days=?,timezone=?,total_ms=?,average_ms=?,answered=?,correct=?,accuracy=?,flips=?,streak=?,longest=?,last_study_day=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND epoch=? AND enabled=1 RETURNING *`).bind(JSON.stringify(days),timezone,summary.totalMs,summary.averageMs,summary.answered,summary.correct,summary.accuracy,summary.flips,summary.streak,summary.longest,summary.lastStudyDay,now,id,data.revision,epoch).first();
    if(!updated)throw fail('rankingConflict',409);return json({profile:publicProfile(updated),summary});
  }
  return json({error:'methodNotAllowed'},405);
}
