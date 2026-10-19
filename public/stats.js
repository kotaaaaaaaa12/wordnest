const STATS_PREFIX='wordnest-learning-v1:';
const IDLE_MS=60000;
const number=value=>Number.isSafeInteger(value) && value>=0?value:0;
export function localDay(timestamp) {
  const date=new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function dayDate(key) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return null;
  const [year,month,day]=key.split('-').map(Number),date=new Date(year,month-1,day);
  return localDay(date.getTime())===key?date:null;
}
function ordinal(key) { const [year,month,day]=key.split('-').map(Number);return Date.UTC(year,month-1,day)/86400000; }
export function mergeLearningIntervals(intervals) {
  const valid=intervals.filter(span=>Array.isArray(span) && span.length===2 && span.every(Number.isFinite) && span[0]>=0 && span[1]>span[0]).map(span=>[...span]).sort((a,b)=>a[0]-b[0]);
  const result=[];
  for(const span of valid){const last=result.at(-1);if(last && span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else result.push(span);}
  return result;
}
export function summarizeLearning(shards,timestamp=Date.now()) {
  const days={};
  for(const shard of shards){
    if(shard?.version!==1 || !shard.days || typeof shard.days!=='object')continue;
    for(const [key,value] of Object.entries(shard.days)){
      if(!dayDate(key) || !value || typeof value!=='object')continue;
      const day=days[key] ||= {answered:0,correct:0,flips:0,intervals:[]};
      day.answered+=number(value.answered);day.correct+=Math.min(number(value.correct),number(value.answered));day.flips+=number(value.flips);
      if(Array.isArray(value.intervals))day.intervals.push(...value.intervals.filter(span=>Array.isArray(span) && localDay(span[0])===key && localDay(span[1]-1)===key));
    }
  }
  let totalMs=0,answered=0,correct=0,flips=0,activeDays=0;
  for(const day of Object.values(days)){
    day.ms=mergeLearningIntervals(day.intervals).reduce((sum,[start,end])=>sum+end-start,0);delete day.intervals;
    totalMs+=day.ms;answered+=day.answered;correct+=day.correct;flips+=day.flips;
    if(day.ms>0 || day.answered>0 || day.flips>0)activeDays++;
  }
  const today=localDay(timestamp),todayOrdinal=ordinal(today),dates=Object.keys(days).filter(key=>days[key].answered>0 || days[key].flips>0).map(ordinal).sort((a,b)=>a-b);
  let longest=0,run=0,previous=null;
  for(const date of dates){run=date===previous+1?run+1:1;longest=Math.max(longest,run);previous=date;}
  let streak=0,cursor=dates.includes(todayOrdinal)?todayOrdinal:todayOrdinal-1;
  const studied=new Set(dates);while(studied.has(cursor)){streak++;cursor--;}
  const recent=Array.from({length:7},(_,index)=>{const date=new Date(timestamp);date.setHours(0,0,0,0);date.setDate(date.getDate()-6+index);const key=localDay(date.getTime());return {date:key,ms:days[key]?.ms || 0};});
  return {days,totalMs,averageMs:activeDays?totalMs/activeDays:0,activeDays,answered,correct,flips,accuracy:answered?correct/answered:null,streak,longest,recent};
}
export class LearningTracker {
  constructor({storage,now=()=>Date.now(),id=globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}={}) {
    this.storage=storage;this.now=now;this.key=STATS_PREFIX+id;this.data={version:1,days:{}};this.active=false;this.cursor=null;this.lastTouch=0;this.dirty=false;this.persistent=Boolean(storage);
  }
  day(timestamp) {return this.data.days[localDay(timestamp)] ||= {answered:0,correct:0,flips:0,intervals:[]};}
  addTime(start,end) {
    while(start<end){
      const next=new Date(start);next.setHours(24,0,0,0);const stop=Math.min(end,next.getTime());if(stop<=start)break;
      const day=this.day(start),last=day.intervals.at(-1);
      if(last && start<=last[1])last[1]=Math.max(last[1],stop);else day.intervals.push([start,stop]);
      this.dirty=true;start=stop;
    }
  }
  tick(timestamp=this.now()) {
    if(!this.active || this.cursor===null)return;
    const end=Math.min(timestamp,this.lastTouch+IDLE_MS);
    if(end>this.cursor)this.addTime(this.cursor,end);
    this.cursor=timestamp;
  }
  setActive(active,timestamp=this.now()) {
    this.tick(timestamp);
    if(active && !this.active){this.lastTouch=timestamp;this.cursor=timestamp;}
    this.active=active;if(!active)this.cursor=null;
    this.persist();
  }
  touch(timestamp=this.now()) {this.tick(timestamp);this.lastTouch=timestamp;}
  answer(correct,timestamp=this.now()) {
    this.tick();const day=this.day(timestamp);day.answered++;if(correct)day.correct++;this.dirty=true;this.persist();
  }
  flip(timestamp=this.now()) {this.tick();this.day(timestamp).flips++;this.dirty=true;this.persist();}
  persist() {
    if(!this.dirty)return;
    try{if(!this.storage)throw new Error('Storage unavailable');this.storage.setItem(this.key,JSON.stringify(this.data));this.persistent=true;this.dirty=false;}catch{this.persistent=false;}
  }
  snapshot(timestamp=this.now()) {
    this.tick(timestamp);this.persist();const shards=[];
    try{
      const keys=Array.from({length:this.storage?.length || 0},(_,index)=>this.storage.key(index));
      for(const key of keys){if(!key?.startsWith(STATS_PREFIX) || key===this.key)continue;try{shards.push(JSON.parse(this.storage.getItem(key)));}catch{}}
    }catch{this.persistent=false;}
    shards.push(this.data);return summarizeLearning(shards,timestamp);
  }
}
