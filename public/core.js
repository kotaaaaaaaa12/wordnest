export const normalize = value => String(value).normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
// Keep the correct positions balanced over a round, without a fixed repeating order.
export function balanceAnswerPositions(questions, random = Math.random) {
  const labels=shuffle([0,1,2,3],random);
  const positions=shuffle(questions.map((_,index)=>labels[index%4]),random);
  return questions.map((question,index)=>{
    const options=shuffle(question.options.filter(option=>normalize(option)!==normalize(question.answer)),random);
    options.splice(positions[index],0,question.answer);
    return {...question,options,...(Array.isArray(question.optionWords)?{optionWords:options.map(option=>question.optionWords[question.options.indexOf(option)] || [])}:{})};
  });
}
function ipaBounds(value){
  let start=value.length-value.trimStart().length,end=value.trimEnd().length;
  while(start<end && ((value[start]==='[' && value[end-1]===']') || (value[start]==='/' && value[end-1]==='/'))){
    start++;end--;
    while(start<end && /\s/u.test(value[start]))start++;
    while(end>start && /\s/u.test(value[end-1]))end--;
  }
  return {start,end:Math.max(start,end),text:value.slice(start,end)};
}
export const normalizeIpa=value=>ipaBounds(value).text;
const ipaSegmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('en',{granularity:'grapheme'}):null;
function ipaCharacters(text){
  if(ipaSegmenter)return [...ipaSegmenter.segment(text)].map(({index,segment})=>[index,index+segment.length]);
  const characters=[];let index=0;
  for(const char of text){if(/\p{Mark}/u.test(char) && characters.length)characters.at(-1)[1]+=char.length;else characters.push([index,index+char.length]);index+=char.length;}
  return characters;
}
function ipaRange(text,start,end){
  const chars=ipaCharacters(text).filter(([a,b])=>a<end && b>start);
  return chars.length?[chars[0][0],chars.at(-1)[1]]:[start,start];
}
function ipaFlags(text,ranges){
  const flags=Array(text.length).fill(false);for(const [start,end] of ranges)flags.fill(true,start,end);return flags;
}
function ipaFlagRanges(flags){
  const ranges=[];for(let i=0;i<flags.length;i++)if(flags[i]){const start=i;while(flags[i+1])i++;ranges.push([start,i+1]);}return ranges;
}
export function ipaItalicRanges(text,ranges=[]){
  if(!Array.isArray(ranges) || ranges.length>200 || ranges.some(range=>!Array.isArray(range) || range.length!==2 || !Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0]<0 || range[0]>=range[1] || range[1]>text.length))throw new Error('invalidIpaStyle');
  return ipaFlagRanges(ipaFlags(text,ranges.map(([start,end])=>ipaRange(text,start,end))));
}
export function normalizeIpaData(value,ranges){
  const normalized=ipaBounds(value),italic=ipaItalicRanges(value,ranges).map(([start,end])=>[Math.max(start,normalized.start)-normalized.start,Math.min(end,normalized.end)-normalized.start]).filter(([start,end])=>end>start);
  return {ipa:normalized.text,...(italic.length?{ipaItalic:ipaItalicRanges(normalized.text,italic)}:{})};
}
export function ipaRawRuns(value,ranges){
  const flags=ipaFlags(value,ipaItalicRanges(value,ranges)),runs=[];
  for(let start=0;start<value.length;){let end=start+1;while(end<value.length && flags[end]===flags[start])end++;runs.push({text:value.slice(start,end),italic:flags[start]});start=end;}
  return runs;
}
export function ipaRuns(value,ranges){const data=normalizeIpaData(value,ranges);return ipaRawRuns(data.ipa,data.ipaItalic);}
export function limitIpaText(value,length=200){const chars=ipaCharacters(value).filter(([,end])=>end<=length);return chars.length?value.slice(0,chars.at(-1)[1]):'';}
export function remapIpaItalic(before,after,ranges,hint){
  const normalized=ipaItalicRanges(before,ranges);if(before===after)return normalized;
  let start=hint?.start,end=hint?.end,added=after.length-before.length+end-start;
  if(start===end && after.length<before.length && hint?.inputType?.startsWith('delete')){
    if(hint.inputType.endsWith('Backward'))start-=before.length-after.length;
    else if(hint.inputType.endsWith('Forward'))end+=before.length-after.length;
    added=after.length-before.length+end-start;
  }
  if(!Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || end>before.length || added<0 || after.slice(0,start)!==before.slice(0,start) || after.slice(start+added)!==before.slice(end)){
    start=0;while(start<before.length && start<after.length && before[start]===after[start])start++;
    end=before.length;let suffix=after.length;while(end>start && suffix>start && before[end-1]===after[suffix-1]){end--;suffix--;}
    added=suffix-start;
  }
  const flags=ipaFlags(before,normalized),inherit=typeof hint?.italic==='boolean'?hint.italic:end>start?flags.slice(start,end).every(Boolean):start>0 && !!flags[start-1] && !!flags[start];
  return ipaItalicRanges(after,ipaFlagRanges([...flags.slice(0,start),...Array(added).fill(inherit),...flags.slice(end)]));
}
export function validateSet(input) {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 150) throw new Error('invalidTitle');
  if (!Array.isArray(input.words) || !input.words.length || input.words.length > 1000) throw new Error('invalidWords');
  if(input.published!==undefined && typeof input.published!=='boolean')throw new Error('invalidVisibility');
  const seen = new Set();
  const words = input.words.map(w => {
    if (!w || typeof w.english !== 'string' || typeof w.meaning !== 'string' || !w.english.trim() || !w.meaning.trim() || w.english.length > 150 || w.meaning.length > 300 || (w.explanation !== undefined && typeof w.explanation !== 'string') || (w.explanation || '').length > 2000) throw new Error('invalidWords');
    if(w.ipa!==undefined && (typeof w.ipa!=='string' || w.ipa.length>200 || /[\u0000-\u001f\u007f]/.test(w.ipa)))throw new Error('invalidIpa');
    const pronunciation=normalizeIpaData(w.ipa || '',w.ipaItalic);
    const key = normalize(w.english);
    if (seen.has(key)) throw new Error('duplicateWord');
    seen.add(key);
    return { english: w.english.trim(), meaning: w.meaning.trim(), explanation: (w.explanation || '').trim(),...(pronunciation.ipa?pronunciation:{}) };
  });
  return { title: input.title.trim(), words,...(input.published===false?{published:false}:{}) };
}
export function questionPool(set, mode) {
  if (mode === 'en-ja') return set.words.map(w => ({ ...w, prompt: w.english, answer: w.meaning }));
  const groups = new Map();
  for (const w of set.words) {
    const key = normalize(w.meaning);
    if (!groups.has(key)) groups.set(key, { ...w, prompt: w.meaning, answer: w.english, accepted: [], explanations: [] });
    const group = groups.get(key);
    group.accepted.push(w.english);
    if (w.explanation) group.explanations.push(`${w.english}: ${w.explanation}`);
  }
  return [...groups.values()].map(q => ({ ...q, explanation: q.explanations.join('\n') }));
}
export function uniqueMeanings(set) {
  return [...new Map(set.words.map(w => [normalize(w.meaning), w.meaning])).values()];
}
export function createQuiz(set, mode, count) {
  if (!['en-ja', 'ja-en'].includes(mode)) throw new Error('invalidMode');
  const pool = questionPool(set, mode);
  if (!Number.isInteger(count) || count < 1 || count > pool.length) throw new Error('invalidCount');
  const meanings = uniqueMeanings(set);
  if (mode === 'en-ja' && meanings.length < 4) throw new Error('needFour');
  const questions=shuffle(pool).slice(0,count).map(q=>({...q,options:mode==='en-ja'?[q.answer,...shuffle(meanings.filter(m=>normalize(m)!==normalize(q.answer))).slice(0,3)]:[]}));
  return mode==='en-ja'?balanceAnswerPositions(questions):questions;
}
export function createFlashcards(set, mode, order = 'original') {
  if (!['en-ja', 'ja-en'].includes(mode)) throw new Error('invalidMode');
  if (!['original', 'reverse', 'random'].includes(order)) throw new Error('invalidOrder');
  const words = order === 'random' ? shuffle(set.words) : order === 'reverse' ? [...set.words].reverse() : [...set.words];
  return words.map(word => ({ ...word, front: mode === 'en-ja' ? word.english : word.meaning, back: mode === 'en-ja' ? word.meaning : word.english }));
}
export const isCorrect = (question, answer, mode) => mode === 'en-ja' ? normalize(answer) === normalize(question.answer) : question.accepted.some(w => normalize(w) === normalize(answer));
export const portable = set => ({ format: 'wordnest-set', version: 1, title: set.title, words: set.words,...(set.published===false?{published:false}:{}) });
export function parseImport(value) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.sets) ? value.sets : [value];
  if (!items.length || items.length > 100) throw new Error('invalidImport');
  return items.map(validateSet);
}

// Snapshot quiz content to reject a clear if the set changes during a round.
export function studyKey(set) {
  const words=set.words.map(word=>[normalize(word.english),normalize(word.meaning)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const content=JSON.stringify(words);
  let first=2166136261,second=2246822507;
  for(let i=0;i<content.length;i++){
    first=Math.imul(first^content.charCodeAt(i),16777619);
    second=Math.imul(second^content.charCodeAt(i),3266489909);
  }
  return `${content.length}:${first>>>0}:${second>>>0}`;
}
export function studyStatus(set,progress) {
  const entry=progress?.[set.id];
  if(!entry || entry.scope!=='all-first-pass')return 'none';
  const english=entry['en-ja']===true,japanese=entry['ja-en']===true;
  return english && japanese?'both':english?'en-ja':japanese?'ja-en':'none';
}
