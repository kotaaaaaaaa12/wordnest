import test from 'node:test';
import assert from 'node:assert/strict';
import { LearningTracker, localDay, summarizeLearning } from '../public/stats.js';
function memoryStorage() {
  const data=new Map();
  return {get length(){return data.size;},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}
const at=(day,hour=12,minute=0,second=0)=>new Date(2026,9,day,hour,minute,second).getTime();
test('learning time pauses for inactivity and inactive screens, resumes on interaction, and survives reopening',()=>{
  const storage=memoryStorage();let now=at(19);const tracker=new LearningTracker({storage,now:()=>now,id:'first'});
  tracker.setActive(true);now+=10000;tracker.answer(true);now+=5000;tracker.setActive(false);
  now+=100000;assert.equal(tracker.snapshot().totalMs,15000);
  tracker.setActive(true);now+=90000;tracker.tick();assert.equal(tracker.snapshot().totalMs,75000);
  tracker.touch();now+=5000;tracker.flip();tracker.setActive(false);
  const summary=new LearningTracker({storage,now:()=>now,id:'reopened'}).snapshot();
  assert.equal(summary.totalMs,80000);assert.equal(summary.answered,1);assert.equal(summary.correct,1);assert.equal(summary.flips,1);assert.equal(summary.activeDays,1);assert.equal(summary.averageMs,80000);
});
test('overlapping tabs union study time while preserving every independent question and flip',()=>{
  const storage=memoryStorage();let now=at(19);const first=new LearningTracker({storage,now:()=>now,id:'tab-a'}),second=new LearningTracker({storage,now:()=>now,id:'tab-b'});
  first.setActive(true);now+=5000;second.setActive(true);first.answer(true);now+=10000;second.flip();first.setActive(false);now+=10000;second.answer(false);second.setActive(false);
  const result=first.snapshot();assert.equal(result.totalMs,25000);assert.equal(result.answered,2);assert.equal(result.correct,1);assert.equal(result.flips,1);assert.equal(result.accuracy,.5);
  assert.equal(second.snapshot().totalMs,25000);
});
test('local midnight, active-day averages, current streak grace, and longest streak follow calendar days',()=>{
  const storage=memoryStorage();let now=at(19,23,59,50);const tracker=new LearningTracker({storage,now:()=>now,id:'calendar'});
  tracker.setActive(true);tracker.flip();now=at(20,0,0,10);tracker.answer(true);tracker.setActive(false);
  let summary=tracker.snapshot();assert.equal(summary.days[localDay(at(19))].ms,10000);assert.equal(summary.days[localDay(at(20))].ms,10000);assert.equal(summary.averageMs,10000);assert.equal(summary.streak,2);assert.equal(summary.longest,2);
  now=at(21);summary=tracker.snapshot();assert.equal(summary.streak,2);assert.equal(summary.activeDays,2);
  now=at(22);summary=tracker.snapshot();assert.equal(summary.streak,0);assert.equal(summary.longest,2);
  tracker.flip();summary=tracker.snapshot();assert.equal(summary.streak,1);assert.equal(summary.longest,2);assert.equal(summary.activeDays,3);assert.equal(summary.averageMs,20000/3);assert.equal(summary.recent.length,7);
});
test('reading without a question or flip contributes study time but does not start a streak',()=>{
  const storage=memoryStorage();let now=at(19);const tracker=new LearningTracker({storage,now:()=>now,id:'reading'});
  tracker.setActive(true);now+=3000;tracker.setActive(false);const result=tracker.snapshot();
  assert.equal(result.totalMs,3000);assert.equal(result.activeDays,1);assert.equal(result.streak,0);
});
test('malformed and unavailable storage never discard the current in-memory learning activity',()=>{
  const storage=memoryStorage();storage.setItem('wordnest-learning-v1:broken','{');storage.setItem('wordnest-learning-v1:bad-shape',JSON.stringify({version:1,days:{invalid:{answered:100},'2026-10-19':{answered:-3,correct:10,flips:'2',intervals:[[0,Infinity],null]}}}));
  const tracker=new LearningTracker({storage,now:()=>at(19),id:'valid'});tracker.answer(true);assert.equal(tracker.snapshot().answered,1);assert.equal(tracker.snapshot().correct,1);
  const unavailable=new LearningTracker({storage:{setItem(){throw new Error('Quota exceeded');}},now:()=>at(19),id:'quota'});unavailable.flip();assert.equal(unavailable.persistent,false);assert.equal(unavailable.snapshot().flips,1);
  const empty=summarizeLearning([null,[],{version:9,days:{}}],at(19));assert.equal(empty.accuracy,null);assert.equal(empty.averageMs,0);assert.equal(empty.activeDays,0);
});
