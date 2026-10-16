import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuiz, isCorrect, normalize, questionPool, validateSet, parseImport, portable } from '../public/core.js';
import { messages } from '../public/i18n.js';
import { seed } from './fixture.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
test('all question counts are unique and contain exactly four distinct answer choices',()=>{
  for(let round=0;round<100;round++)for(const count of [1,5,10,15,20]){
    const questions=createQuiz(seed,'en-ja',count);
    assert.equal(questions.length,count);
    assert.equal(new Set(questions.map(q=>normalize(q.prompt))).size,count);
    for(const q of questions){assert.equal(q.options.length,4);assert.equal(new Set(q.options.map(normalize)).size,4);assert.equal(q.options.filter(o=>normalize(o)===normalize(q.answer)).length,1);assert.ok(q.options.every(o=>seed.words.some(w=>w.meaning===o)));}
  }
});
test('Japanese prompts group duplicate meanings and accept all matching English words',()=>{
  const set=validateSet({title:'Shared meanings',words:[{english:'start',meaning:'始める'},{english:'begin',meaning:'始める'},{english:'finish',meaning:'終える'}]});
  assert.equal(questionPool(set,'ja-en').length,2);
  const q=createQuiz(set,'ja-en',2).find(q=>q.prompt==='始める');
  assert.ok(isCorrect(q,' BEGIN  ','ja-en'));assert.ok(isCorrect(q,'ｓｔａｒｔ','ja-en'));assert.equal(isCorrect(q,'started','ja-en'),false);
  assert.throws(()=>createQuiz(set,'en-ja',1),/needFour/);
});
test('validation rejects empty data, duplicate English words, bad types, and invalid counts',()=>{
  assert.throws(()=>validateSet({title:'  ',words:seed.words}),/invalidTitle/);
  assert.throws(()=>validateSet({title:'Test',words:[]}),/invalidWords/);
  assert.throws(()=>validateSet({title:'Test',words:[{english:'Apple',meaning:'りんご'},{english:' apple ',meaning:'リンゴ'}]}),/duplicateWord/);
  assert.throws(()=>validateSet({title:'Test',words:[{english:'test',meaning:'試験',explanation:{}}]}),/invalidWords/);
  for(const count of [0,-1,1.5,21,NaN])assert.throws(()=>createQuiz(seed,'ja-en',count),/invalidCount/);
});
test('single JSON and multiple zipped JSON sets round trip without server IDs',()=>{
  const json=portable({...seed,id:'secret-id',revision:3});assert.equal(json.id,undefined);
  const files={'001-first.json':strToU8(JSON.stringify(json)),'002-second.json':strToU8(JSON.stringify({...json,title:'Second'}))};
  const loaded=Object.values(unzipSync(zipSync(files))).flatMap(bytes=>parseImport(JSON.parse(strFromU8(bytes))));assert.equal(loaded.length,2);assert.deepEqual(loaded[0],validateSet(seed));
});
test('every user-facing message exists in both languages',()=>{
  assert.deepEqual(Object.keys(messages.en).sort(),Object.keys(messages.ja).sort());
  for(const key of Object.keys(messages.en)){const tokens=s=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(messages.en[key]),tokens(messages.ja[key]),key);}
});
