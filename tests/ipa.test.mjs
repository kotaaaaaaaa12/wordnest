import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSet,normalizeIpa,portable,parseImport,studyKey,studyStatus,createFlashcards} from '../public/core.js';
import {PersonalWords,sourceQuestions,wordIdentity,FlashcardBookmarks} from '../public/personal.js';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
const legacy={title:'Words',words:[{english:'achieve',meaning:'達成する',explanation:'A note.'}]};
const memory=()=>{const values=new Map();return {get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('optional IPA preserves Unicode, accepts pasted delimiters, validates types and length, and keeps legacy JSON compatible',()=>{
  const ipa='əˈtʃiːv',set=structuredClone(legacy);set.words[0].ipa=' [/'+ipa+'/] ';assert.equal(validateSet(set).words[0].ipa,ipa);assert.equal(normalizeIpa('['+ipa+']'),ipa);
  assert.deepEqual(validateSet(legacy),legacy);assert.deepEqual(validateSet({...legacy,words:[{...legacy.words[0],ipa:'[]'}]}),legacy);
  const distinct='ɹ ɻ ʀ ʁ θ ð ɚ ɝ ˈ ˌ ː';assert.equal(validateSet({...legacy,words:[{...legacy.words[0],ipa:distinct}]}).words[0].ipa,distinct);
  for(const value of [null,{},4,[], 'a'.repeat(201),'a\nb','a\tb','a\0b'])assert.throws(()=>validateSet({...legacy,words:[{...legacy.words[0],ipa:value}]}),/invalidIpa/);
  const accented=validateSet({...legacy,title:'Combining marks',words:[{...legacy.words[0],ipa:'ǽ æ̀ æ̂ ǣ æ̆ æ̃ æ̈ é'}]});
  assert.equal(accented.words[0].ipa,'ǽ æ̀ æ̂ ǣ æ̆ æ̃ æ̈ é');
  const saved=validateSet(set),files={'first.json':strToU8(JSON.stringify(portable(saved))),'legacy.json':strToU8(JSON.stringify(portable(legacy))),'accents.json':strToU8(JSON.stringify(portable(accented)))};
  const imported=Object.values(unzipSync(zipSync(files))).flatMap(bytes=>parseImport(JSON.parse(strFromU8(bytes))));assert.deepEqual(imported,[saved,legacy,accented]);
});
test('changing IPA preserves clears, difficult-word streaks, favorites, and resumable flashcards while loading the updated notation',()=>{
  const set={...structuredClone(legacy),id:'words'},edited=structuredClone(set),store=memory(),personal=new PersonalWords(store),originalQuestion=sourceQuestions([set],'en-ja')[0];edited.words[0].ipa='əˈtʃiːv';
  personal.answer(originalQuestion.sources,false);personal.answer(originalQuestion.sources,false);personal.toggleFavorite(wordIdentity(set.id,set.words[0]));
  const progress={[set.id]:{key:studyKey(set),scope:'all-first-pass','en-ja':true,'ja-en':true}};assert.equal(studyStatus(edited,progress),'both');assert.deepEqual(sourceQuestions([edited],'en-ja')[0].sources,originalQuestion.sources);assert.equal(personal.record(originalQuestion.sources[0].key).weak,true);assert.equal(personal.favorite(wordIdentity(edited.id,edited.words[0])),true);
  const bookmarks=new FlashcardBookmarks(store),deck=bookmarks.start('words',createFlashcards(set,'en-ja'),'en-ja','original');deck.flipped=true;bookmarks.save(deck);const resumed=bookmarks.restore('words',createFlashcards(edited,'en-ja'));assert.ok(resumed);assert.equal(resumed.flipped,true);assert.equal(resumed.items[0].ipa,'əˈtʃiːv');
});
