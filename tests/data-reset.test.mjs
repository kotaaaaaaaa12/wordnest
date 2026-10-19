import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalWords } from '../public/personal.js';
import { LearningTracker } from '../public/stats.js';
function storage(){
  const values=new Map();
  return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
const sources=[{key:'question-a'}];
test('personal resets erase only the selected category, including streaks and pending writes in other tabs',()=>{
  const saved=storage(),first=new PersonalWords(saved);let blocked=false;
  const second=new PersonalWords({...saved,setItem(key,value){if(blocked)throw new Error('Quota');saved.setItem(key,value);}});
  first.answer(sources,false);first.answer(sources,false);first.toggleFavorite('word-a');
  blocked=true;second.answer(sources,true);second.toggleFavorite('word-b');assert.equal(second.memory.size,2);
  first.reset('question');assert.equal(first.record('question-a').weak,false);assert.equal(second.record('question-a').successes,0);assert.equal(second.record('question-a').failures,0);assert.equal(second.record('question-a').mistakes,0);assert.equal(first.favorite('word-a'),true);
  blocked=false;second.toggleFavorite('word-c');assert.equal(first.record('question-a').weak,false);assert.equal(first.favorite('word-b'),true);
  first.answer(sources,false);assert.equal(first.record('question-a').failures,1);assert.equal(first.record('question-a').weak,false);
  first.reset('favorite');assert.equal(second.favorite('word-a'),false);assert.equal(second.favorite('word-b'),false);assert.equal(second.favorite('word-c'),false);assert.equal(second.record('question-a').failures,1);
  second.toggleFavorite('word-a');assert.equal(first.favorite('word-a'),true);
});
test('statistics reset clears every shard and prevents other tabs or stale records from restoring deleted totals',()=>{
  const saved=storage();let now=new Date(2026,9,20,12).getTime();
  const first=new LearningTracker({storage:saved,now:()=>now,id:'one'}),second=new LearningTracker({storage:saved,now:()=>now,id:'two'});
  first.setActive(true);second.setActive(true);first.answer(true);second.answer(false);now+=10000;first.setActive(false);second.tick();
  const stale=JSON.stringify(second.data);assert.equal(first.snapshot().answered,2);
  first.reset();assert.equal(first.snapshot().answered,0);assert.equal(first.snapshot().totalMs,0);assert.equal(first.snapshot().flips,0);assert.equal(first.snapshot().streak,0);
  second.persist();assert.equal(second.snapshot().answered,0);assert.equal(second.snapshot().totalMs,0);
  saved.setItem('wordnest-learning-v1:stale',stale);assert.equal(first.snapshot().answered,0);
  now+=2000;second.answer(true);second.flip();second.setActive(false);
  const fresh=first.snapshot();assert.equal(fresh.answered,1);assert.equal(fresh.correct,1);assert.equal(fresh.flips,1);assert.equal(fresh.totalMs,2000);assert.equal(fresh.streak,1);
  first.reset();assert.equal(new LearningTracker({storage:saved,now:()=>now}).snapshot().answered,0);
});
