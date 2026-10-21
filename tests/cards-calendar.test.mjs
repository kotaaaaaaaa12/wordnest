import test from 'node:test';
import assert from 'node:assert/strict';
import { FlashcardBookmarks } from '../public/personal.js';
import { createFlashcards } from '../public/core.js';
import { localDay, studyCalendar, studyActivityLevel } from '../public/stats.js';
import { seed } from './fixture.js';
const storage=()=>{const map=new Map();return {get length(){return map.size;},key:index=>[...map.keys()][index],getItem:key=>map.get(key) ?? null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
test('flashcard bookmarks restore both directions and every order across instances without reshuffling or changing the side',()=>{
  const saved=storage();
  for(const mode of ['en-ja','ja-en'])for(const order of ['original','reverse','random']){
    const context=JSON.stringify([mode,order]),base=createFlashcards(seed,mode),bookmarks=new FlashcardBookmarks(saved),deck=bookmarks.start(context,base,mode,order);
    deck.index=7;deck.flipped=true;bookmarks.save(deck);
    const restored=new FlashcardBookmarks(saved).restore(context,base);assert.equal(restored.index,7);assert.equal(restored.flipped,true);assert.equal(restored.mode,mode);assert.equal(restored.order,order);assert.deepEqual(restored.items,deck.items);
    assert.equal(new FlashcardBookmarks(saved).restore('other-context',base),null);
  }
});
test('changed card content and malformed bookmarks cannot resume, while current card metadata is rebuilt',()=>{
  const saved=storage(),bookmarks=new FlashcardBookmarks(saved),base=createFlashcards(seed,'en-ja').map(card=>({...card,wordRefs:[{setId:'a',setTitle:'Old title',english:card.english,meaning:card.meaning}]}));
  bookmarks.start('set-a',base,'en-ja','random');
  const renamed=structuredClone(base);renamed[0].wordRefs[0].setTitle='New title';assert.equal(bookmarks.restore('set-a',renamed).items.find(card=>card.english===renamed[0].english).wordRefs[0].setTitle,'New title');
  for(const field of ['front','back','explanation']){const changed=structuredClone(base);changed[0][field]+=' changed';assert.equal(bookmarks.restore('set-a',changed),null);}
  assert.equal(bookmarks.restore('set-a',[...base].reverse()),null);
  const key=Array.from({length:saved.length},(_,index)=>saved.key(index)).find(key=>key.startsWith('wordnest-cards-v1:')),original=saved.getItem(key);
  for(const change of [{index:-1},{index:99999},{flipped:'true'},{sequence:['wrong']},{mode:'unknown'},{order:'unknown'}]){saved.setItem(key,JSON.stringify({...JSON.parse(original),...change}));assert.equal(new FlashcardBookmarks(saved).restore('set-a',base),null);}
  saved.setItem(key,'invalid json');assert.equal(new FlashcardBookmarks(saved).restore('set-a',base),null);
});
test('bookmark storage failures retain current-tab progress and another tab reset prevents stale writes from restoring it',()=>{
  const saved=storage();let blocked=true;
  const wrapper={get length(){return saved.length;},key:saved.key,getItem:saved.getItem,removeItem:saved.removeItem,setItem(key,value){if(blocked)throw new Error('Quota');saved.setItem(key,value);}};
  const first=new FlashcardBookmarks(wrapper),base=createFlashcards(seed,'en-ja'),deck=first.start('set-a',base,'en-ja','reverse');deck.index=4;first.save(deck);assert.equal(first.persistent,false);assert.equal(first.restore('set-a',base).index,4);
  blocked=false;first.save(deck);assert.equal(first.persistent,true);assert.equal(new FlashcardBookmarks(saved).restore('set-a',base).index,4);
  new FlashcardBookmarks(saved).reset();first.save(deck);assert.equal(first.restore('set-a',base),null);assert.equal(new FlashcardBookmarks(saved).restore('set-a',base),null);
  first.start('set-a',base,'en-ja','original');assert.equal(new FlashcardBookmarks(saved).restore('set-a',base).index,0);
});
test('study calendar handles leap years, local midnight, empty days, and fixed study-time intensity thresholds',()=>{
  const now=new Date(2024,1,29,12).getTime(),days={'2024-02-29':{ms:900000,answered:4,correct:3,flips:2}},month=studyCalendar('2024-02',days,now);
  assert.equal(month.cells.length,42);assert.equal(month.cells.filter(Boolean).length,29);assert.equal(month.cells[4].date,'2024-02-01');assert.equal(month.cells[32].date,'2024-02-29');assert.equal(month.cells[32].accuracy,.75);assert.equal(month.cells[32].today,true);assert.equal(month.cells[32].level,3);
  assert.equal(studyCalendar('2024-03',days,now).cells.find(Boolean).future,true);
  const midnight=new Date(2024,2,1,0,0,0).getTime();assert.equal(localDay(midnight),'2024-03-01');assert.equal(studyCalendar('2024-02',days,midnight).cells[32].today,false);
  assert.deepEqual([0,1,299999,300000,899999,900000,1799999,1800000].map(ms=>studyActivityLevel({ms,answered:0,flips:0})),[0,1,1,2,2,3,3,4]);assert.equal(studyActivityLevel({ms:0,answered:1,flips:0}),1);assert.equal(studyActivityLevel({ms:0,answered:0,flips:1}),1);assert.equal(month.cells[4].accuracy,null);
  assert.throws(()=>studyCalendar('2024-13'));assert.throws(()=>studyCalendar('invalid'));
});
