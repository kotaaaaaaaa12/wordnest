import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalWords, sourceQuestions, collectionQuestions, quizFromPool, collectionCards, canMultipleChoice, wordIdentity, catalogWord, questionIdentity } from '../public/personal.js';
import { isCorrect, normalize } from '../public/core.js';
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
const set={id:'one',title:'First',words:[{english:'start',meaning:'始める',explanation:'Start here.'},{english:'begin',meaning:'始める'},{english:'finish',meaning:'終える'},{english:'run',meaning:'走る'},{english:'read',meaning:'読む'}]};
test('two consecutive misses register a question and three correct answers anywhere recover it, separately by direction',()=>{
  const saved=storage(),personal=new PersonalWords(saved),en=sourceQuestions([set],'en-ja')[0],ja=sourceQuestions([set],'ja-en')[0],other=sourceQuestions([set],'en-ja')[2];
  personal.answer(en.sources,false);assert.equal(personal.record(en.sources[0].key).weak,false);
  personal.answer(other.sources,false);personal.answer(en.sources,true);personal.answer(en.sources,false);assert.equal(personal.record(en.sources[0].key).failures,1);
  personal.answer(en.sources,false);assert.equal(personal.record(en.sources[0].key).weak,true);assert.equal(personal.record(ja.sources[0].key).weak,false);
  personal.answer(en.sources,true);personal.answer(other.sources,true);personal.answer(en.sources,true);assert.equal(personal.record(en.sources[0].key).successes,2);
  personal.answer(en.sources,false);assert.equal(personal.record(en.sources[0].key).successes,0);assert.equal(personal.record(en.sources[0].key).weak,true);
  const reopened=new PersonalWords(saved);for(let i=0;i<3;i++)reopened.answer(en.sources,true);assert.equal(reopened.record(en.sources[0].key).weak,false);assert.equal(reopened.record(en.sources[0].key).successes,3);
  reopened.answer(en.sources,false);assert.equal(reopened.record(en.sources[0].key).weak,false);reopened.answer(en.sources,false);assert.equal(reopened.record(en.sources[0].key).weak,true);
});
test('question identities survive reordering and notes, reset for changed content, and group Japanese alternate answers',()=>{
  const first=sourceQuestions([set],'ja-en')[0],reordered={...set,title:'Renamed',words:[...set.words].reverse().map(word=>({...word,explanation:'Changed'}))};
  assert.equal(sourceQuestions([reordered],'ja-en').find(q=>q.meaning==='始める').sources[0].key,first.sources[0].key);
  assert.deepEqual(first.accepted,['start','begin']);assert.equal(first.wordRefs.length,2);assert.ok(isCorrect(first,'ＢＥＧＩＮ','ja-en'));
  const changed=structuredClone(set);changed.words[0].english='commence';assert.notEqual(sourceQuestions([changed],'ja-en').find(q=>q.meaning==='始める').sources[0].key,first.sources[0].key);
  const en=sourceQuestions([set],'en-ja')[0],changedMeaning=structuredClone(set);changedMeaning.words[0].meaning='新しい意味';assert.notEqual(sourceQuestions([changedMeaning],'en-ja')[0].sources[0].key,en.sources[0].key);
  assert.equal(wordIdentity(set.id,set.words[0]),wordIdentity(set.id,changedMeaning.words[0]));
});
test('combined selections deduplicate identical questions, preserve source records, and provide full-set alternate answers',()=>{
  const second={...structuredClone(set),id:'two',title:'Second'},personal=new PersonalWords(storage()),all=[set,second];
  for(const question of sourceQuestions(all,'en-ja').filter(q=>q.english==='start')){personal.answer(question.sources,false);personal.answer(question.sources,false);}
  const options={kind:'weak',selectedIds:new Set(['one','two']),record:key=>personal.record(key)};
  const combined=collectionQuestions(all,'en-ja',options);assert.equal(combined.length,1);assert.equal(combined[0].sources.length,2);
  assert.equal(collectionQuestions(all,'en-ja',{...options,selectedIds:new Set(['one'])})[0].sources.length,1);
  assert.equal(collectionQuestions(all,'ja-en',options).length,0);
  for(let i=0;i<3;i++)personal.answer(combined[0].sources,true);assert.equal(collectionQuestions(all,'en-ja',options).length,0);
  personal.toggleFavorite(wordIdentity(set.id,set.words[0]));
  const favorites=collectionQuestions(all,'ja-en',{kind:'favorites',favorite:key=>personal.favorite(key)});assert.equal(favorites.length,1);assert.deepEqual(favorites[0].accepted,['start','begin']);assert.equal(favorites[0].sources.length,1);
});
test('one-word collections use distinct external distractors and collection flashcards preserve answers and ordering',()=>{
  const personal=new PersonalWords(storage());personal.toggleFavorite(wordIdentity(set.id,set.words[0]));
  const pool=collectionQuestions([set],'en-ja',{kind:'favorites',favorite:key=>personal.favorite(key)}),meanings=set.words.map(word=>word.meaning);
  const quiz=quizFromPool(pool,'en-ja',1,meanings);assert.equal(quiz.length,1);assert.equal(new Set(quiz[0].options.map(normalize)).size,4);assert.ok(quiz[0].options.includes('始める'));
  assert.throws(()=>quizFromPool(pool,'en-ja',1,['始める']),/needFour/);
  const japanese=collectionQuestions([set],'ja-en',{kind:'favorites',favorite:key=>personal.favorite(key)}),cards=collectionCards(japanese,'ja-en','original');assert.equal(cards[0].front,'始める');assert.equal(cards[0].back,'start / begin');
  const words=[catalogWord(set,set.words[0]),catalogWord({...set,id:'two'},set.words[0]),catalogWord(set,set.words[2])];assert.equal(collectionCards(words,'en-ja','original').length,2);assert.equal(collectionCards(words,'en-ja','reverse')[0].front,'finish');
});
test('favorites persist independently of recovery and storage failures retain current-tab changes',()=>{
  const saved=storage(),personal=new PersonalWords(saved),key=wordIdentity(set.id,set.words[0]),question=sourceQuestions([set],'en-ja')[0];
  assert.equal(personal.toggleFavorite(key),true);personal.answer(question.sources,false);personal.answer(question.sources,false);for(let i=0;i<3;i++)personal.answer(question.sources,true);assert.equal(personal.favorite(key),true);
  assert.equal(new PersonalWords(saved).favorite(key),true);assert.equal(personal.toggleFavorite(key),false);
  const unavailable=new PersonalWords({getItem(){throw new Error('Unavailable');},setItem(){throw new Error('Quota');}});unavailable.toggleFavorite(key);assert.equal(unavailable.favorite(key),true);assert.equal(unavailable.persistent,false);
});

test('combined English prompts appear once and other valid senses never become distractors',()=>{
  const first={id:'a',title:'A',words:[{english:'run',meaning:'走る'}]},second={id:'b',title:'B',words:[{english:'run',meaning:'経営する'}]};
  const pool=collectionQuestions([first,second],'en-ja',{kind:'favorites',favorite:()=>true});
  assert.equal(pool.length,1);assert.equal(pool[0].answer,'走る / 経営する');assert.equal(pool[0].sources.length,2);
  const bank=[...first.words,...second.words,{english:'run',meaning:'流れる'},{english:'read',meaning:'読む'},{english:'eat',meaning:'食べる'},{english:'sleep',meaning:'眠る'}];
  const meanings=bank.map(word=>word.meaning),quiz=quizFromPool(pool,'en-ja',1,meanings,bank);
  assert.equal(quiz[0].options.length,4);assert.deepEqual(quiz[0].options.filter(option=>option!==quiz[0].answer).sort(),['読む','食べる','眠る'].sort());
  assert.equal(canMultipleChoice(pool,meanings.slice(0,4),bank.slice(0,4)),false);
  assert.equal(canMultipleChoice(pool,[pool[0].answer],bank),true);
});

test('one difficult word uses its complete original set for all three distractors',()=>{
  const personal=new PersonalWords(storage()),target=sourceQuestions([set],'en-ja')[0];personal.answer(target.sources,false);personal.answer(target.sources,false);
  const unrelated={id:'other',title:'Other',words:[{english:'red',meaning:'赤い'},{english:'blue',meaning:'青い'},{english:'green',meaning:'緑の'},{english:'yellow',meaning:'黄色い'}]};
  const sets=[set,unrelated],pool=collectionQuestions(sets,'en-ja',{kind:'weak',record:key=>personal.record(key)}),bank=sets.flatMap(source=>source.words.map(word=>catalogWord(source,word)));
  assert.equal(pool.length,1);assert.equal(canMultipleChoice(pool,pool.map(q=>q.answer),bank),true);
  for(let i=0;i<40;i++){
    const questions=quizFromPool(pool,'en-ja',1,pool.map(q=>q.answer),bank);assert.equal(questions.length,1);assert.equal(questions[0].prompt,'start');
    assert.deepEqual(questions[0].options.filter(option=>option!==questions[0].answer).sort(),['終える','走る','読む'].sort());assert.deepEqual(questions[0].sources,pool[0].sources);
  }
});
test('each combined question uses its own source set; small sets fall back only as needed',()=>{
  const other={id:'other',title:'Other',words:[{english:'red',meaning:'赤い'},{english:'blue',meaning:'青い'},{english:'green',meaning:'緑の'},{english:'yellow',meaning:'黄色い'}]},sets=[set,other];
  const personal=new PersonalWords(storage());for(const source of sets){const q=sourceQuestions([source],'en-ja')[0];personal.answer(q.sources,false);personal.answer(q.sources,false);}
  const bank=sets.flatMap(source=>source.words.map(word=>catalogWord(source,word))),pool=collectionQuestions(sets,'en-ja',{kind:'weak',record:key=>personal.record(key)});
  for(const q of quizFromPool(pool,'en-ja',2,[],bank)){const source=sets.find(source=>source.id===q.sources[0].setId);assert.ok(q.options.every(option=>source.words.some(word=>word.meaning===option)));}
  const tiny={id:'tiny',title:'Tiny',words:set.words.slice(0,3)},smallPool=sourceQuestions([tiny],'en-ja').slice(0,1),smallBank=[tiny,other].flatMap(source=>source.words.map(word=>catalogWord(source,word)));
  const q=quizFromPool(smallPool,'en-ja',1,[],smallBank)[0];assert.equal(q.options.length,4);assert.ok(q.options.includes('終える'));assert.equal(q.options.filter(option=>other.words.some(word=>word.meaning===option)).length,2);
  assert.equal(canMultipleChoice(smallPool,[],tiny.words),false);assert.throws(()=>quizFromPool(smallPool,'en-ja',1,[],tiny.words),/needFour/);
  assert.equal(quizFromPool(sourceQuestions([tiny],'ja-en').slice(0,1),'ja-en',1,[],tiny.words).length,1);
});
