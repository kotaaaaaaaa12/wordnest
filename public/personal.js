import { normalize, questionPool, shuffle } from './core.js';
const PREFIX='wordnest-personal-v1:';
// Keep storage keys bounded even when a question has many accepted answers.
function keyToken(value) {
  let first=2166136261,second=2246822507;
  for(let i=0;i<value.length;i++){first=Math.imul(first^value.charCodeAt(i),16777619);second=Math.imul(second^value.charCodeAt(i),3266489909);}
  return `${value.length}:${first>>>0}:${second>>>0}`;
}
export const wordIdentity=(setId,word)=>JSON.stringify([setId,normalize(word.english)]);
export function questionIdentity(setId,question,mode) {
  return JSON.stringify(mode==='en-ja'?[setId,mode,normalize(question.english),normalize(question.meaning)]:[setId,mode,normalize(question.meaning),question.accepted.map(normalize).sort()]);
}
export function catalogWord(set,word) {return {...word,setId:set.id,setTitle:set.title,wordKey:wordIdentity(set.id,word)};}
export function findCatalogWord(sets,key) {
  try{const [id,english]=JSON.parse(key),set=sets.find(set=>set.id===id),word=set?.words.find(word=>normalize(word.english)===english);return word?catalogWord(set,word):null;}catch{return null;}
}
export function sourceQuestions(sets,mode) {
  return sets.flatMap(set=>{
    const groups=new Map();
    for(const word of set.words){const key=normalize(mode==='en-ja'?word.english:word.meaning);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(catalogWord(set,word));}
    return questionPool(set,mode).map(question=>({...question,wordRefs:groups.get(normalize(mode==='en-ja'?question.english:question.meaning)),sources:[{key:questionIdentity(set.id,question,mode),setId:set.id,setTitle:set.title}]}));
  });
}
export function mergeQuestions(questions,mode) {
  const groups=new Map();
  for(const question of questions){
    const key=normalize(question.prompt);
    const previous=groups.get(key);
    if(!previous){groups.set(key,{...structuredClone(question),...(mode==='en-ja'?{meanings:[question.meaning]}:{})});continue;}
    previous.sources.push(...question.sources.filter(source=>!previous.sources.some(old=>old.key===source.key)));
    previous.wordRefs.push(...question.wordRefs.filter(word=>!previous.wordRefs.some(old=>old.wordKey===word.wordKey)));
    if(mode==='en-ja'){previous.meanings=[...new Map([...previous.meanings,question.meaning].map(meaning=>[normalize(meaning),meaning])).values()];previous.answer=previous.meaning=previous.meanings.join(' / ');}
    if(mode==='ja-en')previous.accepted=[...new Map([...previous.accepted,...question.accepted].map(word=>[normalize(word),word])).values()];
    if(question.explanation && !(previous.explanation || '').includes(question.explanation))previous.explanation=[previous.explanation,question.explanation].filter(Boolean).join('\n');
  }
  return [...groups.values()];
}
export function collectionQuestions(sets,mode,{kind,selectedIds,favorite,record}={}) {
  const selected=sets.filter(set=>!selectedIds || selectedIds.has(set.id));
  const pool=sourceQuestions(selected,mode).filter(question=>kind==='weak'?question.sources.some(source=>record(source.key).weak):question.wordRefs.some(word=>favorite(word.wordKey)));
  return mergeQuestions(pool,mode);
}
function choiceBank(meanings,words) {
  const meaningsByKey=new Map(meanings.map(meaning=>[normalize(meaning),meaning])),byEnglish=new Map();
  for(const word of words){const key=normalize(word.english);if(!byEnglish.has(key))byEnglish.set(key,new Set());byEnglish.get(key).add(normalize(word.meaning));}
  return {meaningsByKey,entries:[...meaningsByKey],byEnglish};
}
function validMeanings(question,bank) {return new Set([normalize(question.answer),...(question.meanings || []).map(normalize),...(bank.byEnglish.get(normalize(question.prompt)) || [])]);}
function hasChoices(pool,bank) {return pool.length>0 && pool.every(question=>bank.entries.length-[...validMeanings(question,bank)].filter(key=>bank.meaningsByKey.has(key)).length>=3);}
function sampleIncorrect(question,bank) {
  const valid=validMeanings(question,bank),chosen=new Map();
  const add=index=>{const [key,value]=bank.entries[index];if(!valid.has(key))chosen.set(key,value);};
  for(let i=0;i<24 && chosen.size<3;i++)add(Math.floor(Math.random()*bank.entries.length));
  const offset=Math.floor(Math.random()*bank.entries.length);
  for(let i=0;i<bank.entries.length && chosen.size<3;i++)add((offset+i)%bank.entries.length);
  return [...chosen.values()];
}
export function canMultipleChoice(pool,meanings,words=[]) {return hasChoices(pool,choiceBank(meanings,words));}
export function quizFromPool(pool,mode,count,meanings,words=[]) {
  if(!Number.isInteger(count) || count<1 || count>pool.length)throw new Error('invalidCount');
  const bank=mode==='en-ja'?choiceBank(meanings,words):null;
  if(bank && !hasChoices(pool,bank))throw new Error('needFour');
  return shuffle(pool).slice(0,count).map(question=>({...structuredClone(question),options:mode==='en-ja'?shuffle([question.answer,...sampleIncorrect(question,bank)]):[]}));
}
export function collectionCards(words,mode,order) {
  let cards;
  if(words.length && words[0].sources){
    cards=words.map(question=>({...structuredClone(question),front:question.prompt,back:mode==='en-ja'?question.meaning:question.accepted.join(' / ')}));
  }else{
    const groups=new Map();
    for(const word of words){const key=JSON.stringify([normalize(word.english),normalize(word.meaning)]),previous=groups.get(key);if(previous)previous.wordRefs.push(word);else groups.set(key,{...word,wordRefs:[word],front:mode==='en-ja'?word.english:word.meaning,back:mode==='en-ja'?word.meaning:word.english});}
    cards=[...groups.values()];
  }
  return order==='random'?shuffle(cards):order==='reverse'?[...cards].reverse():cards;
}
const clean=value=>({failures:Number.isInteger(value?.failures)?Math.max(0,Math.min(2,value.failures)):0,successes:Number.isInteger(value?.successes)?Math.max(0,Math.min(3,value.successes)):0,mistakes:Number.isSafeInteger(value?.mistakes)?Math.max(0,value.mistakes):0,weak:value?.weak===true});
export class PersonalWords {
  constructor(storage){this.storage=storage;this.memory=new Map();this.persistent=Boolean(storage);this.epochs={question:this.readEpoch('question'),favorite:this.readEpoch('favorite')};}
  readEpoch(type){try{return this.storage?.getItem('wordnest-reset-'+type) || '';}catch{return this.epochs?.[type] || '';}}
  syncResets(){
    for(const type of ['question','favorite']){const epoch=this.readEpoch(type);if(epoch===this.epochs[type])continue;this.epochs[type]=epoch;for(const name of this.memory.keys())if(name.startsWith(PREFIX+type+':'))this.memory.delete(name);}
  }
  reset(type){
    if(!['question','favorite'].includes(type))throw new Error('Invalid personal data type');
    const prefix=PREFIX+type+':',keys=Array.from({length:this.storage?.length || 0},(_,index)=>this.storage.key(index)).filter(key=>key?.startsWith(prefix));
    if(!this.storage)throw new Error('Storage unavailable');
    this.storage.setItem('wordnest-reset-'+type,globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    this.syncResets();for(const key of keys)this.storage.removeItem(key);this.persistent=true;
  }
  read(type,key) {this.syncResets();const name=PREFIX+type+':'+keyToken(key);if(this.memory.has(name))return this.memory.get(name);try{const raw=this.storage?.getItem(name),value=raw?JSON.parse(raw):null;return (value?.epoch || '')===this.epochs[type]?value:null;}catch{return null;}}
  write(type,key,value) {this.syncResets();const name=PREFIX+type+':'+keyToken(key);this.memory.set(name,{...value,epoch:this.epochs[type]});try{if(!this.storage)throw new Error('Storage unavailable');for(const [pending,entry] of this.memory){this.storage.setItem(pending,JSON.stringify(entry));this.memory.delete(pending);}this.persistent=true;}catch{this.persistent=false;}}
  record(key){return clean(this.read('question',key));}
  answer(sources,correct) {
    for(const key of new Set(sources.map(source=>source.key))){
      const previous=this.read('question',key);if(correct && !previous)continue;
      const next=clean(previous);
      if(correct){next.failures=0;next.successes=Math.min(3,next.successes+1);if(next.successes===3)next.weak=false;}
      else{next.successes=0;next.failures=Math.min(2,next.failures+1);next.mistakes++;if(next.failures===2)next.weak=true;}
      this.write('question',key,next);
    }
  }
  favorite(key){return this.read('favorite',key)?.on===true;}
  toggleFavorite(key){const on=!this.favorite(key);this.write('favorite',key,{on});return on;}
}
