export const normalize = value => String(value).normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function validateSet(input) {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 150) throw new Error('invalidTitle');
  if (!Array.isArray(input.words) || !input.words.length || input.words.length > 1000) throw new Error('invalidWords');
  const seen = new Set();
  const words = input.words.map(w => {
    if (!w || typeof w.english !== 'string' || typeof w.meaning !== 'string' || !w.english.trim() || !w.meaning.trim() || w.english.length > 150 || w.meaning.length > 300 || (w.explanation !== undefined && typeof w.explanation !== 'string') || (w.explanation || '').length > 2000) throw new Error('invalidWords');
    const key = normalize(w.english);
    if (seen.has(key)) throw new Error('duplicateWord');
    seen.add(key);
    return { english: w.english.trim(), meaning: w.meaning.trim(), explanation: (w.explanation || '').trim() };
  });
  return { title: input.title.trim(), words };
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
  return shuffle(pool).slice(0, count).map(q => ({ ...q, options: mode === 'en-ja' ? shuffle([q.answer, ...shuffle(meanings.filter(m => normalize(m) !== normalize(q.answer))).slice(0, 3)]) : [] }));
}
export const isCorrect = (question, answer, mode) => mode === 'en-ja' ? normalize(answer) === normalize(question.answer) : question.accepted.some(w => normalize(w) === normalize(answer));
export const portable = set => ({ format: 'wordnest-set', version: 1, title: set.title, words: set.words });
export function parseImport(value) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.sets) ? value.sets : [value];
  if (!items.length || items.length > 100) throw new Error('invalidImport');
  return items.map(validateSet);
}
