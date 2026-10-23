import { normalize, questionPool, shuffle, balanceAnswerPositions } from './core.js';
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
  // Source words provide candidates even when the practice pool contains only one word.
  const meaningsByKey=new Map([...meanings,...words.map(word=>word.meaning)].map(meaning=>[normalize(meaning),meaning])),byEnglish=new Map(),bySet=new Map(),byMeaning=new Map();
  for(const word of words){
    const meaning=normalize(word.meaning);if(!byMeaning.has(meaning))byMeaning.set(meaning,[]);byMeaning.get(meaning).push(word);
    const key=normalize(word.english);if(!byEnglish.has(key))byEnglish.set(key,new Set());byEnglish.get(key).add(normalize(word.meaning));
    if(word.setId){if(!bySet.has(word.setId))bySet.set(word.setId,new Map());bySet.get(word.setId).set(normalize(word.meaning),word.meaning);}
  }
  return {meaningsByKey,entries:[...meaningsByKey],byEnglish,bySet,byMeaning};
}
function validMeanings(question,bank) {return new Set([normalize(question.answer),...(question.meanings || []).map(normalize),...(bank.byEnglish.get(normalize(question.prompt)) || [])]);}
function hasChoices(pool,bank) {return pool.length>0 && pool.every(question=>bank.entries.length-[...validMeanings(question,bank)].filter(key=>bank.meaningsByKey.has(key)).length>=3);}
function sampleIncorrect(question,bank) {
  const valid=validMeanings(question,bank),chosen=new Map();
  const draw=entries=>{
    if(!entries.length)return;
    const add=index=>{const [key,value]=entries[index];if(!valid.has(key))chosen.set(key,value);};
    for(let i=0;i<24 && chosen.size<3;i++)add(Math.floor(Math.random()*entries.length));
    const offset=Math.floor(Math.random()*entries.length);
    for(let i=0;i<entries.length && chosen.size<3;i++)add((offset+i)%entries.length);
  };
  const ids=new Set([...(question.sources || []).map(source=>source.setId),...(question.wordRefs || []).map(word=>word.setId)]);
  const sourceEntries=new Map();
  for(const id of ids)for(const [key,value] of bank.bySet.get(id) || [])sourceEntries.set(key,value);
  draw([...sourceEntries]);
  // Very small source sets may need additional meanings from the rest of the library.
  if(chosen.size<3)draw(bank.entries);
  return [...chosen.values()];
}
export function canMultipleChoice(pool,meanings,words=[]) {return hasChoices(pool,choiceBank(meanings,words));}
export function quizFromPool(pool,mode,count,meanings,words=[]) {
  if(!Number.isInteger(count) || count<1 || count>pool.length)throw new Error('invalidCount');
  const bank=mode==='en-ja'?choiceBank(meanings,words.length?words:pool.flatMap(question=>question.wordRefs || [question])):null;
  if(bank && !hasChoices(pool,bank))throw new Error('needFour');
  const questions=shuffle(pool).slice(0,count).map(question=>({...structuredClone(question),options:mode==='en-ja'?[question.answer,...sampleIncorrect(question,bank)]:[]}));
  if(mode!=='en-ja')return questions;
  return balanceAnswerPositions(questions).map(question=>{
    const ids=new Set([...(question.sources || []).map(source=>source.setId),...(question.wordRefs || []).map(word=>word.setId)]);
    const optionWords=question.options.map(option=>{
      const candidates=bank.byMeaning.get(normalize(option)) || [],local=candidates.filter(word=>ids.has(word.setId));
      return [...new Map((local.length?local:candidates).filter(word=>typeof word.english==='string').map(word=>[normalize(word.english),word.english])).values()];
    });
    return {...question,optionWords};
  });
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

const CARD_PREFIX='wordnest-cards-v1:';
const cardIdentity=card=>keyToken(JSON.stringify([card.front,card.back,card.explanation || '',(card.wordRefs || []).map(word=>[word.setId,word.english,word.meaning]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
export class FlashcardBookmarks {
  constructor(storage){this.storage=storage;this.pending=new Map();this.epoch=this.readEpoch();this.persistent=Boolean(storage);}
  readEpoch(){try{return this.storage?.getItem('wordnest-reset-cards') || '';}catch{return this.epoch || '';}}
  syncReset(){const epoch=this.readEpoch();if(epoch!==this.epoch){this.epoch=epoch;this.pending.clear();}}
  read(context){
    this.syncReset();const key=CARD_PREFIX+keyToken(context);let value,raw;
    try{value=this.pending.get(key);if(!value)raw=this.storage?.getItem(key);}catch{this.persistent=false;return null;}
    if(!value)try{value=JSON.parse(raw || 'null');}catch{return null;}
    return value?.version===1 && value.epoch===this.epoch && ['en-ja','ja-en'].includes(value.mode) && ['original','reverse','random'].includes(value.order)?value:null;
  }
  start(context,base,mode,order){
    this.syncReset();const items=order==='random'?shuffle(base):order==='reverse'?[...base].reverse():[...base];
    const deck={mode,order,items,index:0,flipped:false,checkpoint:{context,epoch:this.epoch,signature:keyToken(JSON.stringify(base.map(cardIdentity))),sequence:items.map(cardIdentity)}};
    this.save(deck);return deck;
  }
  restore(context,base){
    const saved=this.read(context);if(!saved || !Array.isArray(saved.sequence) || !Number.isInteger(saved.index) || saved.index<0 || saved.index>=base.length || typeof saved.flipped!=='boolean')return null;
    const identities=base.map(cardIdentity),cards=new Map(base.map((card,index)=>[identities[index],card]));
    if(saved.signature!==keyToken(JSON.stringify(identities)) || saved.sequence.length!==base.length || new Set(saved.sequence).size!==base.length || saved.sequence.some(id=>!cards.has(id)))return null;
    return {mode:saved.mode,order:saved.order,index:saved.index,flipped:saved.flipped,items:saved.sequence.map(id=>cards.get(id)),checkpoint:{context,epoch:this.epoch,signature:saved.signature,sequence:saved.sequence}};
  }
  save(deck){
    this.syncReset();const checkpoint=deck.checkpoint;if(!checkpoint || checkpoint.epoch!==this.epoch)return;
    const key=CARD_PREFIX+keyToken(checkpoint.context),value={version:1,epoch:this.epoch,mode:deck.mode,order:deck.order,index:deck.index,flipped:deck.flipped,signature:checkpoint.signature,sequence:checkpoint.sequence,updated:Date.now()};
    this.pending.set(key,value);
    try{
      if(!this.storage)throw new Error('Storage unavailable');
      for(const [name,entry] of this.pending){this.storage.setItem(name,JSON.stringify(entry));this.pending.delete(name);}
      const keys=Array.from({length:this.storage.length},(_,index)=>this.storage.key(index)).filter(name=>name?.startsWith(CARD_PREFIX));
      if(keys.length>100){const entries=keys.map(name=>{try{return [name,JSON.parse(this.storage.getItem(name))?.updated || 0];}catch{return [name,0];}}).sort((a,b)=>b[1]-a[1]);for(const [name] of entries.filter(([name])=>name!==key).slice(99))this.storage.removeItem(name);}
      this.persistent=true;
    }catch{this.persistent=false;}
  }
  reset(){
    if(!this.storage)throw new Error('Storage unavailable');
    const keys=Array.from({length:this.storage.length},(_,index)=>this.storage.key(index)).filter(key=>key?.startsWith(CARD_PREFIX));
    this.storage.setItem('wordnest-reset-cards',globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);this.syncReset();
    for(const key of keys)this.storage.removeItem(key);this.persistent=true;
  }
}
