import { mergeLearningIntervals, summarizeStudyDays } from './stats.js?v=2.3.1-63bdb72444e14e9a';
export const categories=['learning','question','favorite','progress','cards'];
export function studyCategory(key){
  if(key==='wordnest-progress')return 'progress';
  if(key.startsWith('wordnest-learning-v1:'))return 'learning';
  if(key.startsWith('wordnest-personal-v1:question:'))return 'question';
  if(key.startsWith('wordnest-personal-v1:favorite:'))return 'favorite';
  if(key.startsWith('wordnest-cards-v1:'))return 'cards';
  return null;
}
export const epochKey=category=>'wordnest-reset-'+category;
export function eraseGuestData(storage){
 const keys=Array.from({length:storage?.length || 0},(_,index)=>storage.key(index)).filter(Boolean);
 for(const category of categories)storage.setItem(epochKey(category),globalThis.crypto.randomUUID());
 for(const key of keys)if(studyCategory(key))storage.removeItem(key);
 // Do not automatically create a replacement identity or republish old data.
 storage.setItem('wordnest-ranking-v1',JSON.stringify({choice:'declined',erased:true}));
}
export const emptyStudy=()=>({epochs:Object.fromEntries(categories.map(category=>[category,''])),entries:{}});
const invalid=()=>{throw new Error('accountInvalidData');};
const object=value=>value && typeof value==='object' && !Array.isArray(value);
const integer=value=>Number.isSafeInteger(value) && value>=0;
export function validateStudyEntry(key,value){
  const category=studyCategory(key);if(!category || key.length>240 || /[\u0000-\u001f]/.test(key) || !object(value))invalid();
  if(category==='learning'){
    if(value.version!==1 || !object(value.days) || Object.keys(value.days).length>20000)invalid();
    for(const [date,day] of Object.entries(value.days)){
      const midnight=Date.parse(date+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10)!==date || midnight<946684800000 || midnight>Date.now()+86400000 || !object(day) || !['answered','correct','flips'].every(field=>integer(day[field]) && day[field]<=1000000) || day.correct>day.answered || !Array.isArray(day.intervals) || day.intervals.length>20000)invalid();
      for(const span of day.intervals)if(!Array.isArray(span) || span.length!==2 || !span.every(Number.isSafeInteger) || span[0]<midnight-86400000 || span[1]>midnight+2*86400000 || span[1]<=span[0] || span[1]-span[0]>25*3600000)invalid();
    }
  }else if(category==='question'){
    if(!['failures','successes','mistakes'].every(field=>integer(value[field])) || value.failures>2 || value.successes>3 || typeof value.weak!=='boolean')invalid();
  }else if(category==='favorite'){
    if(typeof value.on!=='boolean')invalid();
  }else if(category==='progress'){
    if(Object.keys(value).length>1000)invalid();
    for(const [id,entry] of Object.entries(value))if(!/^[a-zA-Z0-9-]{1,80}$/.test(id) || !object(entry) || typeof entry.key!=='string' || entry.key.length>1000 || entry.scope!=='all-first-pass' || typeof entry['en-ja']!=='boolean' || typeof entry['ja-en']!=='boolean')invalid();
  }else if(category==='cards'){
    if(value.version!==1 || !['en-ja','ja-en'].includes(value.mode) || !['original','reverse','random'].includes(value.order) || !integer(value.index) || typeof value.flipped!=='boolean' || typeof value.signature!=='string' || !Array.isArray(value.sequence) || value.sequence.length>5000 || value.sequence.some(item=>typeof item!=='string' || item.length>240) || !integer(value.updated))invalid();
  }
  if(JSON.stringify(value).length>1000000)invalid();
  return category;
}
export function mergeShard(old,incoming){
  const result=structuredClone(old || incoming);result.days ||= {};
  for(const [date,day] of Object.entries(incoming.days)){
    const previous=result.days[date];
    result.days[date]=previous?{answered:Math.max(previous.answered,day.answered),correct:Math.max(previous.correct,day.correct),flips:Math.max(previous.flips,day.flips),intervals:mergeLearningIntervals([...previous.intervals,...day.intervals])}:structuredClone(day);
  }
  return result;
}
export function importStudy(entries){
  if(!object(entries) || Object.keys(entries).length>20000)invalid();
  const study=emptyStudy();
  for(const category of categories){const epoch=entries[epochKey(category)];if(epoch!==undefined && (typeof epoch!=='string' || epoch.length>120))invalid();study.epochs[category]=epoch || '';}
  for(const [key,raw] of Object.entries(entries)){
    if(categories.some(category=>key===epochKey(category)))continue;
    let value;try{value=typeof raw==='string'?JSON.parse(raw):raw;}catch{invalid();}const category=validateStudyEntry(key,value);
    if(category!=='progress' && (value.epoch || '')!==study.epochs[category])continue;
    study.entries[key]=value;
  }
  return study;
}
export function applyStudyOperation(study,op){
  if(!object(op) || typeof op.id!=='string' || !/^[a-zA-Z0-9-]{1,100}$/.test(op.id) || !categories.includes(op.category) || typeof op.epoch!=='string' || op.epoch.length>120)invalid();
  if(op.type==='reset'){
    if(typeof op.nextEpoch!=='string' || !op.nextEpoch || op.nextEpoch.length>120)invalid();
    if(study.epochs[op.category]!==op.epoch)return;
    study.epochs[op.category]=op.nextEpoch;
    for(const key of Object.keys(study.entries))if(studyCategory(key)===op.category)delete study.entries[key];
    return;
  }
  if(op.type==='import'){
    if(!object(op.epochs))invalid();
    const incoming=importStudy(op.entries);
    for(const [key,value] of Object.entries(incoming.entries)){
      const category=studyCategory(key);if(op.epochs[category]!==study.epochs[category])continue;
      if(category==='learning')study.entries[key]=mergeShard(study.entries[key],value);
      else if(category==='progress'){
        const previous=study.entries[key] ||= {};
        for(const [id,clear] of Object.entries(value))previous[id]={...clear,'en-ja':clear['en-ja'] || previous[id]?.['en-ja']===true,'ja-en':clear['ja-en'] || previous[id]?.['ja-en']===true};
      }else if(!study.entries[key])study.entries[key]=value;
      if(category!=='progress')study.entries[key].epoch=study.epochs[category];
    }
    return;
  }
  // A stale offline device cannot resurrect data cleared on another device.
  if(op.epoch!==study.epochs[op.category])return;
  if(op.type==='answer'){
    if(op.category!=='question' || typeof op.correct!=='boolean' || !Array.isArray(op.keys) || op.keys.length<1 || op.keys.length>200 || op.keys.some(key=>typeof key!=='string' || key.length>240 || studyCategory(key)!=='question'))invalid();
    for(const key of new Set(op.keys)){
      const previous=study.entries[key];if(op.correct && !previous)continue;
      const next=previous?{...previous}:{failures:0,successes:0,mistakes:0,weak:false};
      if(op.correct){next.failures=0;next.successes=Math.min(3,next.successes+1);if(next.successes===3)next.weak=false;}
      else{next.successes=0;next.failures=Math.min(2,next.failures+1);next.mistakes++;if(next.failures===2)next.weak=true;}
      next.epoch=op.epoch;study.entries[key]=next;
    }
    return;
  }
  if(op.type!=='set' || validateStudyEntry(op.key,op.value)!==op.category || op.category==='question')invalid();
  const old=study.entries[op.key],value=structuredClone(op.value);
  if(op.category==='learning')study.entries[op.key]=mergeShard(old,value);
  else if(op.category==='progress'){
    const progress=study.entries[op.key] ||= {};
    for(const [id,clear] of Object.entries(value))progress[id]={...clear,'en-ja':clear['en-ja'] || old?.[id]?.['en-ja']===true,'ja-en':clear['ja-en'] || old?.[id]?.['ja-en']===true};
  }else study.entries[op.key]=value;
  if(op.category!=='progress')study.entries[op.key].epoch=op.epoch;
}
export function accountStudyDays(study){
  const days={};
  for(const [key,shard] of Object.entries(study.entries))if(studyCategory(key)==='learning')for(const [date,day] of Object.entries(shard.days)){
    const result=days[date] ||= {answered:0,correct:0,flips:0,intervals:[]};
    result.answered+=day.answered;result.correct+=day.correct;result.flips+=day.flips;result.intervals.push(...day.intervals);
  }
  for(const day of Object.values(days)){day.ms=mergeLearningIntervals(day.intervals).reduce((total,[a,b])=>total+b-a,0);delete day.intervals;}
  return days;
}
export function accountStudySummary(study,today){const days=accountStudyDays(study);return {days,summary:summarizeStudyDays(days,today)};}
