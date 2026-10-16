import { normalize, validateSet, questionPool, uniqueMeanings, createQuiz, isCorrect, portable, parseImport } from './core.js';
import { messages, translator } from './i18n.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate.js';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage = { get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, value); } catch {} } };
let languageChoice = storage.get('wordnest-language','auto');
if (!['auto','en','ja'].includes(languageChoice)) languageChoice = 'auto';
let lang, t;
function setLanguage() { lang = languageChoice === 'auto' ? (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en') : languageChoice; t = translator(lang); document.documentElement.lang = lang; document.title = `Wordnest — ${t('home')}`; }
setLanguage();
let themeChoice = storage.get('wordnest-theme', 'auto');
if (!['auto', 'light', 'dark'].includes(themeChoice)) themeChoice = 'auto';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const theme = themeChoice === 'auto' ? (systemTheme.matches ? 'dark' : 'light') : themeChoice;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171d1a' : '#f6f5f0');
}
applyTheme();
systemTheme.addEventListener?.('change', () => { if (themeChoice === 'auto') applyTheme(); });
const state = { sets: [], loaded:false, loadError:'', authenticated:false, configured:true, route:location.hash.startsWith('#/edit')?'edit':'home', screen:'home', selected:new Set(), search:'', setId:null, mode:null, count:5, countChoice:5, custom:false, customValue:'5', quiz:null, draft:null, dirty:false, error:'', saving:false };
let soundEnabled = storage.get('wordnest-sound','on') === 'on';
const sounds = Object.fromEntries(['correct','incorrect','confetti'].map(name => { const audio = new Audio(`/assets/audio/${name}.mp3`); audio.preload='auto'; return [name,audio]; }));
function play(name) { if (!soundEnabled) return; try { sounds[name].currentTime=0; sounds[name].play()?.catch(()=>{}); } catch {} }
const paths = { settings:'<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>', book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z"/>', edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-4L4 15z"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', back:'<path d="M20 12H4m6-6-6 6 6 6"/>', plus:'<path d="M12 4v16M4 12h16"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>', check:'<path d="m5 12 4 4L20 5"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>', search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', sound:'<path d="M4 9h4l5-5v16l-5-5H4zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', mute:'<path d="M4 9h4l5-5v16l-5-5H4zm13 0 5 6m0-6-5 6"/>', lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>', trophy:'<path d="M8 3h8v8a4 4 0 0 1-8 0zM8 5H3v3a5 5 0 0 0 5 5m8-8h5v3a5 5 0 0 1-5 5M12 15v6m-4 0h8"/>', refresh:'<path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6"/>', leaf:'<path d="M20 3C7 2 2 9 7 15s14-1 13-12zM5 21 16 9"/>' };
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.book}</svg>`;
const btn = (key, action, type='ghost', extra='') => `<button class="btn ${type}" data-action="${action}" ${extra}>${t(key)}</button>`;
let toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000); }
function message(error) { return t(messages.en[error.message] ? error.message : 'networkError'); }
async function api(path, options={}) {
  let response;
  try { response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}}); } catch { throw new Error('networkError'); }
  let data; try { data=await response.json(); } catch { throw new Error('serverError'); }
  if (!response.ok) { if (response.status===401) state.authenticated=false; throw new Error(data.error || 'serverError'); }
  return data;
}
async function load() {
  state.loadError=''; render();
  try { const [data, session]=await Promise.all([api('/api/sets'),api('/api/session')]); state.sets=data.sets; state.authenticated=session.authenticated; state.configured=session.configured; state.loaded=true; }
  catch(error) { state.loadError=message(error); }
  render();
}
function shell(content) {
  return `<div class="app-shell"><aside class="sidebar"><a href="#/" data-nav="home" class="brand"><span class="brand-mark"><svg aria-hidden="true" viewBox="0 0 48 48"><path d="m9 15 7 20 8-15 8 15 7-20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>wordnest<span style="color:var(--accent)">.</span></a><nav class="nav" aria-label="${t('home')}"><a href="#/" data-nav="home" class="${state.route==='home'?'active':''}">${icon('book')}${t('home')}</a><a href="#/edit" data-nav="edit" class="${state.route==='edit'?'active':''}">${icon('edit')}${t('edit')}</a></nav><div class="sidebar-bottom"><p class="side-caption">${t('brandTag')}</p><button class="settings-trigger" data-action="settings">${icon('settings')}${t('settings')}</button></div></aside><main class="main"><div class="topline"><span><span class="status-dot"></span>${t('homeCount')}</span><span>WORDNEST / ${state.route==='edit'?'EDIT':'PRACTICE'}</span></div>${content}<footer class="footer"><span>${t('footer')}</span><span>WORDNEST © ${new Date().getFullYear()}</span></footer></main></div>`;
}
function render() {
  const active = document.activeElement;
  const focusId = active?.id;
  const selection = active && typeof active.selectionStart==='number' ? [active.selectionStart,active.selectionEnd] : null;
  let content;
  if (state.loadError) content=`<div class="empty"><h2>${e(state.loadError)}</h2>${btn('retry','reload','primary')}</div>`;
  else if (!state.loaded) content=`<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
  else if (state.route==='edit') content=editor();
  else if (state.screen==='mode') content=modes();
  else if (state.screen==='count') content=counts();
  else if (state.screen==='quiz') content=quizView();
  else if (state.screen==='result') content=resultView();
  else content=home();
  $('#app').innerHTML=shell(content);
  if (focusId && document.getElementById(focusId) && !['language'].includes(focusId)) { const el=document.getElementById(focusId); el.focus({preventScroll:true}); if(selection && el.setSelectionRange) el.setSelectionRange(...selection); }
}
function home() {
  const visible=state.sets.filter(s=>normalize(s.title).includes(normalize(state.search)));
  return `<section class="hero"><div><div class="eyebrow">${t('eyebrow')}</div><h1>${t('headline')}</h1><p>${t('intro')}</p></div><div class="word-art" aria-hidden="true"><div class="art-card"></div><div class="art-card front"><strong>Aa</strong><span class="art-line"></span></div><span class="art-spark">✳</span></div></section><section><div class="section-bar"><div class="section-heading"><h2>${t('library')}</h2><span class="count">${t('setsCount',{n:state.sets.length})}</span></div><button class="icon-btn" data-action="reload" aria-label="${t('refresh')}">${icon('refresh')}</button></div><div class="toolbar"><div class="search">${icon('search')}<input id="search" type="search" placeholder="${t('search')}" aria-label="${t('search')}" value="${e(state.search)}"></div></div><div class="grid">${visible.map(s=>`<article class="set-card"><div class="card-head"><span class="set-symbol">${icon('book')}</span></div><button class="card-open" data-action="open" data-id="${e(s.id)}"><h3>${e(s.title)}</h3><span class="visually-hidden">${t('openSet')}</span></button><div class="card-bottom"><span>${t('wordsCount',{n:s.words.length})}</span><button class="icon-btn" data-action="open" data-id="${e(s.id)}" aria-label="${t('openSet')}">${icon('arrow')}</button></div></article>`).join('')}</div>${!visible.length?`<div class="empty"><h2>${t(state.sets.length?'noResults':'empty')}</h2>${!state.sets.length?`<p>${t('emptyHelp')}</p>`:''}</div>`:''}</section>`;
}
const currentSet=()=>state.sets.find(s=>s.id===state.setId);
function flowTitle(title,help,step) { return `<div class="flow-title"><div class="eyebrow">${e(currentSet()?.title)}</div>${step?`<span class="pill">${t('step',{n:step})}</span>`:''}<h1>${t(title)}</h1><p>${t(help)}</p></div>`; }
function modes() {
  const set=currentSet(); if(!set) {state.screen='home';return home();}
  const enough=uniqueMeanings(set).length>=4;
  return `<section class="flow"><button class="back" data-action="back-home">${icon('back')}${t('chooseSet')}</button>${flowTitle('chooseMode','modeHelp',1)}<div class="mode-grid"><button class="mode-card" data-action="mode" data-mode="en-ja" ${!enough?'disabled':''}><span class="direction">EN<span class="arrow">→</span>JA</span><h3>${t('choice')}</h3><p>${t('choiceHelp')}</p></button><button class="mode-card" data-action="mode" data-mode="ja-en"><span class="direction">JA<span class="arrow">→</span>EN</span><h3>${t('typing')}</h3><p>${t('typingHelp')}</p></button></div>${!enough?`<p class="notice">${t('needFour')}</p>`:''}</section>`;
}
function counts() {
  const max=questionPool(currentSet(),state.mode).length;
  return `<section class="flow"><button class="back" data-action="back-mode">${icon('back')}${t('back')}</button>${flowTitle('chooseCount','countHelp',2)}<span class="pill">${state.mode==='en-ja'?'EN → JA':'JA → EN'}</span><div class="count-grid">${[5,10,15,'all','custom'].map(n=>`<button class="count-btn ${n==='custom'?state.custom?'active':'':!state.custom && state.countChoice===n?'active':''}" data-action="count" data-count="${n}" ${typeof n==='number'&&n>max?'disabled':''}>${typeof n==='number'?n:t(n)}</button>`).join('')}</div>${state.custom?`<label class="custom-count" for="custom-count">${t('countLabel')}<input id="custom-count" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${e(state.customValue)}"></label>`:''}${state.error?`<p class="error" role="alert">${e(state.error)}</p>`:''}<div class="flow-bottom"><span class="count">${t('available',{n:max})}</span><button class="btn primary" data-action="start">${t('start')}${icon('arrow')}</button></div></section>`;
}
function quizView() {
  const qz=state.quiz,q=qz.questions[qz.index],result=qz.answers[qz.index];
  return `<section class="quiz"><div class="quiz-meta"><span>${e(qz.title)} · ${qz.mode==='en-ja'?'EN → JA':'JA → EN'}</span><button class="text-btn" data-action="quit">${t('quit')}</button></div><div class="progress" role="progressbar" aria-label="${t('questions')}" aria-valuenow="${qz.index+Number(!!result)}" aria-valuemin="0" aria-valuemax="${qz.questions.length}"><span style="width:${(qz.index+Number(!!result))/qz.questions.length*100}%"></span></div><div class="quiz-meta" style="margin-bottom:16px"><span>${t('questionOf',{n:qz.index+1,total:qz.questions.length})}</span><span>${t('correctCount',{n:qz.answers.filter(a=>a.correct).length})}</span></div><div class="question-card"><div class="eyebrow">${t(qz.mode==='en-ja'?'meaningPrompt':'englishPrompt')}</div><div class="question-word" ${qz.mode==='en-ja'?'lang="en"':'lang="ja"'}>${e(q.prompt)}</div></div>${qz.mode==='en-ja'?`<div class="options">${q.options.map((option,i)=>`<button class="option ${result?(normalize(option)===normalize(q.answer)?'correct':option===result.answer?'wrong':''):''}" data-action="answer" data-option="${i}" ${result?'disabled':''}><span class="letter">${'ABCD'[i]}</span><span lang="ja">${e(option)}</span></button>`).join('')}</div>`:`<form id="answer-form" class="typing-form"><label class="visually-hidden" for="typed-answer">${t('englishPrompt')}</label><input id="typed-answer" lang="en" name="answer" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="${t('answerPlaceholder')}" value="${e(qz.typed||'')}" ${result?'disabled':''}><button class="btn primary" type="submit" ${result?'disabled':''}>${t('check')}</button></form>`}${result?`<div class="feedback ${result.correct?'':'wrong'}" role="status"><h3>${t(result.correct?'correct':'incorrect')}</h3><p>${t('correctAnswer')}: <strong>${e(qz.mode==='ja-en'?q.accepted.join(' / '):q.answer)}</strong></p>${!result.correct?`<p>${t('yourAnswer')}: ${e(result.answer||t('skipped'))}</p>`:''}${q.explanation?`<small>${t('explanation')}</small><p>${e(q.explanation)}</p>`:''}</div>`:''}<div class="quiz-actions">${!result?btn('skip','skip','ghost'):btn(qz.index===qz.questions.length-1?'results':'next','next','green')}</div></section>`;
}
function resultView() {
  const qz=state.quiz,correct=qz.answers.filter(a=>a.correct).length,perfect=correct===qz.questions.length;
  return `<section class="flow"><div class="result-hero"><div class="result-medal">${icon(perfect?'trophy':'leaf')}</div><h1>${t(perfect?'perfect':'completed')}</h1><p>${t(perfect?'perfectHelp':'completedHelp')}</p><div class="score-number">${correct}<small> / ${qz.questions.length}</small></div><span class="pill">${Math.round(correct/qz.questions.length*100)}%</span></div><div class="center-actions">${btn('again','again','primary')}${btn('returnHome','back-home')}</div><div class="review"><h2>${t('review')}</h2>${qz.questions.map((q,i)=>{const a=qz.answers[i];return `<div class="review-item"><span class="verdict ${a.correct?'':'bad'}" aria-label="${t(a.correct?'correctLabel':'incorrectLabel')}">${a.correct?'✓':'×'}</span><div><strong>${e(q.english)} — ${e(q.meaning)}</strong>${!a.correct?`<p>${t('yourAnswer')}: ${e(a.answer||t('skipped'))}</p>`:''}${qz.mode==='ja-en' && q.accepted.length>1?`<p>${t('correctAnswer')}: ${e(q.accepted.join(' / '))}</p>`:''}${q.explanation?`<p>${e(q.explanation)}</p>`:''}</div></div>`}).join('')}</div></section>`;
}
function editor() {
  if(!state.authenticated) return `<section class="login-card"><span class="set-symbol">${icon('lock')}</span><div><h1>${t('loginTitle')}</h1><p>${t('loginHelp')}</p></div>${!state.configured?`<div class="error">${t('passwordSetup')}</div>`:`<form id="login-form"><label for="password">${t('password')}<input type="password" id="password" name="password" autocomplete="current-password" required minlength="12" maxlength="512"></label>${state.error?`<p class="error" role="alert">${e(state.error)}</p>`:''}<button class="btn primary" ${state.saving?'disabled':''}>${icon('lock')}${t('login')}</button></form>`}<small>${t('sessionNote')}</small></section>`;
  const draft=state.draft;
  return `<section><div class="edit-heading"><div class="eyebrow">${t('unlocked')}</div><h1>${t('editTitle')}</h1><p>${t('editIntro')}</p></div><div class="toolbar editor-toolbar"><button class="btn ghost small" data-action="logout">${icon('lock')}${t('logout')}</button></div><div class="editor-layout"><aside class="set-list" aria-label="${t('library')}">${state.sets.map(s=>`<button class="${draft?.id===s.id?'active':''}" data-action="edit-set" data-id="${e(s.id)}">${e(s.title)}<small>${t('wordsCount',{n:s.words.length})}</small></button>`).join('')}</aside><div class="editor-panel ${state.saving?'busy':''}">${draft?`<label for="set-title">${t('title')}<input id="set-title" maxlength="150" value="${e(draft.title)}" placeholder="${t('setTitlePlaceholder')}"></label><div class="row"><span class="count">${t('wordsCount',{n:draft.words.length})}</span></div><div class="editor-words">${draft.words.map((w,i)=>`<article class="word-row"><div class="word-row-head"><span>${t('wordNumber',{n:i+1})}</span><button class="icon-btn" data-action="remove-word" data-index="${i}" aria-label="${t('removeWord')}">${icon('trash')}</button></div><div class="word-fields"><label for="word-${i}-english">${t('word')}<input id="word-${i}-english" data-word="${i}" data-field="english" lang="en" value="${e(w.english)}" maxlength="150" placeholder="${t('englishPlaceholder')}" autocapitalize="none" spellcheck="false"></label><label for="word-${i}-meaning">${t('meaning')}<input id="word-${i}-meaning" data-word="${i}" data-field="meaning" value="${e(w.meaning)}" maxlength="300" placeholder="${t('meaningPlaceholder')}"></label><label class="wide" for="word-${i}-explanation">${t('explanation')} · ${t('optional')}<textarea id="word-${i}-explanation" data-word="${i}" data-field="explanation" maxlength="2000" placeholder="${t('explanationPlaceholder')}">${e(w.explanation)}</textarea></label></div></article>`).join('')}</div><button class="btn ghost" data-action="add-word" ${draft.words.length>=1000?'disabled':''}>${icon('plus')}${t('addWord')}</button>${state.error?`<p class="error" role="alert">${e(state.error)}</p>`:''}<div class="editor-actions"><span class="muted" id="dirty-label">${state.dirty?t('unsaved'):''}</span><button class="btn primary" data-action="save" ${state.saving?'disabled':''}>${icon('check')}${t(state.saving?'saving':'save')}</button></div>`:`<div class="empty"><p>${t('editorEmpty')}</p></div>`}</div></div></section>`;
}
const modal=$('#modal');
function dialog(content, setup) {
  return new Promise(resolve=>{
    const previous=document.activeElement;
    modal.innerHTML=content;
    modal.setAttribute('aria-labelledby','modal-title');
    let settled=false;
    const finish=value=>{ if(settled)return; settled=true; modal.close(); modal.oncancel=null; modal.onclick=null; modal.onchange=null; if(previous?.isConnected) previous.focus({preventScroll:true}); resolve(value); };
    modal.oncancel=event=>{event.preventDefault();finish(false);};
    modal.onclick=event=>{const button=event.target.closest('[data-dialog]');if(button)finish(button.dataset.dialog==='confirm');};
    modal.showModal(); $('#modal-title',modal)?.focus({preventScroll:true});
    setup?.(finish);
  });
}
function confirmDialog(title,help,confirm='discard',danger=false) {
  return dialog(`<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t(title)}</h2><p>${e(help)}</p><div class="modal-actions"><button class="btn ghost" data-dialog="cancel">${t('cancel')}</button><button class="btn ${danger?'danger':'primary'}" data-dialog="confirm">${t(confirm)}</button></div>`);
}
async function discardGuard() { return !state.dirty || await confirmDialog('unsavedTitle',t('unsavedHelp'),'discard',true); }
async function navigate(route, fromHistory=false) {
  if(state.saving)return;
  if(!await discardGuard()) { if(fromHistory)history.pushState(null,'',state.route==='edit'?'#/edit':'#/');return; }
  if(state.screen==='quiz' && !await confirmDialog('quitTitle',t('quitHelp'),'confirmQuit')) { if(fromHistory)history.pushState(null,'',state.route==='edit'?'#/edit':'#/');return; }
  state.route=route;state.screen='home';state.quiz=null;state.dirty=false;state.draft=null;state.error='';
  if(!fromHistory)history.pushState(null,'',route==='edit'?'#/edit':'#/');
  render();window.scrollTo(0,0);
}
function markDirty() { state.dirty=true;state.error='';const label=$('#dirty-label');if(label)label.textContent=t('unsaved'); }
function download(blob,filename) {const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function filename(title) {return title.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'word-set';}
function exportSets(sets) {
  if(!sets.length)return;
  if(sets.length===1)download(new Blob([JSON.stringify(portable(sets[0]),null,2)],{type:'application/json'}),`${filename(sets[0].title)}.json`);
  else {const files={};sets.forEach((s,i)=>{files[`${String(i+1).padStart(3,'0')}-${filename(s.title)}.json`]=strToU8(JSON.stringify(portable(s),null,2));});download(new Blob([zipSync(files,{level:6})],{type:'application/zip'}),'wordnest-sets.zip');}
  toast(t('exportDone'));
}
function settingsContent() {
  return `<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t('settings')}</h2><div class="settings-section"><label for="theme-choice">${t('appearance')}<select id="theme-choice">${['auto','light','dark'].map(value=>`<option value="${value}" ${themeChoice===value?'selected':''}>${t(value)}</option>`).join('')}</select></label><label for="settings-language">${t('language')}<select id="settings-language"><option value="auto" ${languageChoice==='auto'?'selected':''}>${t('auto')}</option><option value="en" ${languageChoice==='en'?'selected':''}>English</option><option value="ja" ${languageChoice==='ja'?'selected':''}>日本語</option></select></label><button class="btn ghost" data-settings-sound aria-pressed="${soundEnabled}">${icon(soundEnabled?'sound':'mute')}${t(soundEnabled?'soundOn':'soundOff')}</button></div><div class="settings-section"><h3>${t('wordData')}</h3><div class="settings-buttons"><button class="btn ghost" data-settings-action="export" ${!state.sets.length?'disabled':''}>${icon('download')}${t('export')}</button><button class="btn ghost" data-settings-action="import" ${!state.authenticated?'disabled':''}>${icon('upload')}${t('import')}</button>${state.route==='edit' && state.authenticated?`<button class="btn ghost" data-settings-action="new">${icon('plus')}${t('newSet')}</button>`:''}${state.draft?`<button class="btn ghost" data-settings-action="export-draft">${t('draftExport')}</button>`:''}${state.draft?.id && state.authenticated?`<button class="btn danger" data-settings-action="delete">${icon('trash')}${t('deleteSet')}</button>`:''}</div>${!state.authenticated?`<p class="notice">${t('dataUnlockHint')}</p>`:''}</div><div class="modal-actions"><button class="btn primary" data-dialog="cancel">${t('close')}</button></div>`;
}
async function settingsDialog() {
  const action=await dialog(settingsContent(),finish=>{
    modal.onchange=event=>{
      if(event.target.id==='theme-choice'){themeChoice=event.target.value;storage.set('wordnest-theme',themeChoice);applyTheme();}
      else if(event.target.id==='settings-language'){languageChoice=event.target.value;storage.set('wordnest-language',languageChoice);setLanguage();render();modal.innerHTML=settingsContent();$('#modal-title',modal)?.focus({preventScroll:true});}
    };
    modal.onclick=event=>{
      if(event.target.closest('[data-dialog]')){finish(false);return;}
      if(event.target.closest('[data-settings-sound]')){soundEnabled=!soundEnabled;storage.set('wordnest-sound',soundEnabled?'on':'off');modal.innerHTML=settingsContent();$('#modal-title',modal)?.focus({preventScroll:true});return;}
      const button=event.target.closest('[data-settings-action]');
      if(button && !button.disabled)finish(button.dataset.settingsAction);
    };
  });
  if(action==='export')await exportDialog();
  else if(action==='import')await importDialog();
  else if(action)await actions[action]?.();
}
async function exportDialog() {
  function content(){return `<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t('export')}</h2><p>${t('selectionHelp')}</p><button class="text-btn" data-export-all>${t(state.selected.size===state.sets.length?'clearSelection':'selectAll')}</button><div class="import-list">${state.sets.map(s=>`<div class="import-item"><label><input type="checkbox" data-export-id="${e(s.id)}" ${state.selected.has(s.id)?'checked':''}><span><strong>${e(s.title)}</strong><small>${t('wordsCount',{n:s.words.length})}</small></span></label></div>`).join('')}</div><div class="modal-actions"><button class="btn ghost" data-dialog="cancel">${t('cancel')}</button><button class="btn primary" id="export-confirm" ${!state.selected.size?'disabled':''}>${t('exportSelected')} (${state.selected.size})</button></div>`;}
  await dialog(content(),finish=>{
    modal.onchange=event=>{
      const id=event.target.dataset.exportId;if(!id)return;
      if(event.target.checked)state.selected.add(id);else state.selected.delete(id);
      const button=$('#export-confirm',modal);button.disabled=!state.selected.size;button.textContent=`${t('exportSelected')} (${state.selected.size})`;
    };
    modal.onclick=event=>{
      if(event.target.closest('[data-dialog]')){finish(false);return;}
      if(event.target.closest('[data-export-all]')){state.selected=state.selected.size===state.sets.length?new Set():new Set(state.sets.map(s=>s.id));modal.innerHTML=content();$('#modal-title',modal)?.focus({preventScroll:true});return;}
      if(event.target.closest('#export-confirm') && state.selected.size){exportSets(state.sets.filter(s=>state.selected.has(s.id)));finish(true);}
    };
  });
}
async function importDialog() {
  if(!await discardGuard())return;
  let imported=[],selected=new Set(),busy=false;
  await dialog(`<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t('importTitle')}</h2><p>${t('importHelp')}</p><label class="file-picker">${t('chooseFiles')}<small>${t('fileHint')}</small><input type="file" id="import-files" accept=".json,.zip,application/json,application/zip" multiple></label><div id="import-preview"></div><p class="error" id="import-error" role="alert" hidden></p><div class="modal-actions"><button class="btn ghost" data-dialog="cancel">${t('cancel')}</button><button class="btn primary" id="import-confirm" disabled>${t('import')}</button></div>`,finish=>{
    const error=$('#import-error',modal),preview=$('#import-preview',modal),submit=$('#import-confirm',modal);
    function updatePreview(){preview.innerHTML=imported.length?`<p>${t('importReady',{n:imported.length,words:imported.reduce((n,s)=>n+s.words.length,0)})}</p><p>${t('importedSelection')}</p><div class="actions"><button class="text-btn" id="import-all">${t(selected.size===imported.length?'clearSelection':'selectAll')}</button></div><div class="import-list">${imported.map((s,i)=>`<div class="import-item"><label><input type="checkbox" data-import="${i}" ${selected.has(i)?'checked':''}><span><strong>${e(s.title)}</strong><small>${t('wordsCount',{n:s.words.length})}</small></span></label></div>`).join('')}</div>`:'';submit.disabled=!selected.size;submit.textContent=t('importConfirm',{n:selected.size});}
    $('#import-files',modal).onchange=async event=>{
      error.hidden=true;imported=[];selected.clear();submit.disabled=true;preview.innerHTML='';
      try {
        const files=[...event.target.files];if(files.length>100||files.reduce((n,f)=>n+f.size,0)>8*1024*1024)throw new Error('tooLarge');
        let totalBytes=0;
        for(const file of files){
          if(/\.zip$/i.test(file.name)) {
            const bytes=new Uint8Array(await file.arrayBuffer());let declared=0,count=0;
            const contents=unzipSync(bytes,{filter:entry=>{if(!/\.json$/i.test(entry.name)||entry.name.startsWith('__MACOSX/'))return false;declared+=entry.originalSize;count++;if(declared+totalBytes>1900000||count>100)throw new Error('tooLarge');return true;}});
            const entries=Object.values(contents);if(!entries.length)throw new Error('invalidImport');
            for(const bytes of entries){totalBytes+=bytes.length;if(totalBytes>1900000)throw new Error('tooLarge');imported.push(...parseImport(JSON.parse(strFromU8(bytes))));}
          } else if(/\.json$/i.test(file.name)){totalBytes+=file.size;if(totalBytes>1900000)throw new Error('tooLarge');imported.push(...parseImport(JSON.parse(await file.text())));}
          else throw new Error('invalidImport');
        }
        if(!imported.length||imported.length>100)throw new Error('invalidImport');
        if(strToU8(JSON.stringify({sets:imported})).length>2*1024*1024)throw new Error('tooLarge');
        selected=new Set(imported.map((_,i)=>i));updatePreview();
      }catch(err){imported=[];selected.clear();preview.innerHTML='';error.textContent=messages.en[err.message]?message(err):t('invalidImport');error.hidden=false;submit.disabled=true;}
    };
    preview.onclick=event=>{if(event.target.id==='import-all'){selected=selected.size===imported.length?new Set():new Set(imported.map((_,i)=>i));updatePreview();}};
    preview.onchange=event=>{if(event.target.dataset.import!==undefined){const i=Number(event.target.dataset.import);if(event.target.checked)selected.add(i);else selected.delete(i);submit.disabled=!selected.size;submit.textContent=t('importConfirm',{n:selected.size});}};
    submit.onclick=async()=>{
      if(busy||!selected.size)return;busy=true;submit.disabled=true;submit.textContent=t('importing');error.hidden=true;modal.oncancel=event=>event.preventDefault();$$('[data-dialog]',modal).forEach(b=>b.disabled=true);$('#import-files',modal).disabled=true;
      try{const data=await api('/api/sets',{method:'POST',body:JSON.stringify({sets:imported.filter((_,i)=>selected.has(i))})});state.sets.unshift(...data.sets);state.dirty=false;state.draft=structuredClone(data.sets[0]);toast(t('importDone',{n:data.sets.length}));finish(true);render();}
      catch(err){error.textContent=message(err);error.hidden=false;busy=false;submit.disabled=false;submit.textContent=t('importConfirm',{n:selected.size});$$('[data-dialog]',modal).forEach(b=>b.disabled=false);$('#import-files',modal).disabled=false;modal.oncancel=event=>{event.preventDefault();finish(false);};}
    };
  });
  render();
}
function submitAnswer(answer,skipped=false) {
  const qz=state.quiz;if(qz.answers[qz.index])return;
  const q=qz.questions[qz.index],correct=!skipped&&isCorrect(q,answer,qz.mode);
  qz.answers[qz.index]={answer:answer.trim(),correct};play(correct?'correct':'incorrect');render();
}
let confettiFrame=0;
function confetti() {
  cancelAnimationFrame(confettiFrame);const canvas=$('#confetti'),ctx=canvas.getContext('2d');if(!ctx)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const width=innerWidth,height=innerHeight,ratio=Math.min(devicePixelRatio||1,2);canvas.width=width*ratio;canvas.height=height*ratio;ctx.scale(ratio,ratio);
  const colors=['#e9603b','#719168','#e6b451','#93aac2','#b69bc0'];const pieces=Array.from({length:160},()=>({x:Math.random()*width,y:-Math.random()*height*.9-20,v:1.8+Math.random()*3,w:4+Math.random()*5,angle:Math.random()*6.3,drift:Math.random()*2-1,color:colors[Math.floor(Math.random()*colors.length)]}));let start;
  function draw(time){if(!start)start=time;ctx.clearRect(0,0,width,height);const elapsed=time-start;for(const p of pieces){p.x+=p.drift;p.y+=p.v;p.angle+=.045;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);ctx.fillStyle=p.color;ctx.globalAlpha=elapsed>4500?Math.max(0,1-(elapsed-4500)/1200):1;ctx.fillRect(-p.w/2,-p.w/2,p.w,p.w*.55);ctx.restore();}if(elapsed<5700)confettiFrame=requestAnimationFrame(draw);else ctx.clearRect(0,0,width,height);}confettiFrame=requestAnimationFrame(draw);
}
const actions={
  settings:settingsDialog,
  sound(){soundEnabled=!soundEnabled;storage.set('wordnest-sound',soundEnabled?'on':'off');render();},
  async reload(){if(!await discardGuard())return;state.dirty=false;state.draft=null;state.selected.clear();state.loaded=false;state.screen='home';state.quiz=null;await load();},
  open(button){state.setId=button.dataset.id;state.screen='mode';state.error='';render();window.scrollTo(0,0);},
  'back-home'(){state.screen='home';state.quiz=null;cancelAnimationFrame(confettiFrame);const c=$('#confetti');c.getContext('2d')?.clearRect(0,0,c.width,c.height);render();window.scrollTo(0,0);},
  'back-mode'(){state.screen='mode';state.error='';render();},
  mode(button){state.mode=button.dataset.mode;state.screen='count';const max=questionPool(currentSet(),state.mode).length;state.count=Math.min(5,max);state.countChoice=max<5?'all':5;state.custom=false;state.error='';render();},
  count(button){const value=button.dataset.count;state.custom=value==='custom';if(!state.custom){state.countChoice=value==='all'?'all':Number(value);state.count=value==='all'?questionPool(currentSet(),state.mode).length:Number(value);}state.error='';render();},
  start(){const max=questionPool(currentSet(),state.mode).length,count=state.custom?Number(state.customValue):state.count;if(!Number.isInteger(count)||count<1||count>max){state.error=t('invalidCount',{n:max});render();return;}try{const set=currentSet();state.quiz={title:set.title,mode:state.mode,questions:createQuiz(set,state.mode,count),index:0,answers:[],typed:''};state.screen='quiz';state.error='';render();window.scrollTo(0,0);}catch(err){state.error=message(err);render();}},
  answer(button){submitAnswer(state.quiz.questions[state.quiz.index].options[Number(button.dataset.option)]);},
  skip(){submitAnswer('',true);},
  next(){const qz=state.quiz;if(!qz.answers[qz.index])return;if(qz.index===qz.questions.length-1){state.screen='result';const perfect=qz.answers.every(a=>a.correct);render();if(perfect){play('confetti');confetti();}window.scrollTo(0,0);}else{qz.index++;qz.typed='';render();window.scrollTo(0,0);}},
  async quit(){if(await confirmDialog('quitTitle',t('quitHelp'),'confirmQuit'))actions['back-home']();},
  again(){state.screen='count';state.quiz=null;state.error='';render();window.scrollTo(0,0);},
  'select-all'(){state.selected=state.selected.size===state.sets.length?new Set():new Set(state.sets.map(s=>s.id));render();},
  'export-selected'(){exportSets(state.sets.filter(s=>state.selected.has(s.id)));},
  'export-draft'(){exportSets([state.draft]);},
  async new(){if(!await discardGuard())return;state.draft={title:t('newTitle'),words:[{english:'',meaning:'',explanation:''}]};state.dirty=true;state.error='';render();},
  async 'edit-set'(button){if(state.draft?.id===button.dataset.id)return;if(!await discardGuard())return;state.draft=structuredClone(state.sets.find(s=>s.id===button.dataset.id));state.dirty=false;state.error='';render();},
  'add-word'(){state.draft.words.push({english:'',meaning:'',explanation:''});markDirty();render();const index=state.draft.words.length-1;$(`#word-${index}-english`)?.focus({preventScroll:true});$(`#word-${index}-english`)?.scrollIntoView({block:'center',behavior:'auto'});},
  async 'remove-word'(button){if(!await confirmDialog('removeTitle',t('removeHelp'),'remove',true))return;state.draft.words.splice(Number(button.dataset.index),1);markDirty();render();},
  async save(){if(state.saving)return;try{const data=validateSet(state.draft);state.saving=true;state.error='';render();let saved;if(state.draft.id){saved=(await api(`/api/sets/${state.draft.id}`,{method:'PUT',body:JSON.stringify({...data,revision:state.draft.revision})})).set;state.sets=state.sets.map(s=>s.id===saved.id?saved:s);}else{saved=(await api('/api/sets',{method:'POST',body:JSON.stringify(data)})).sets[0];state.sets.unshift(saved);}state.draft=structuredClone(saved);state.dirty=false;toast(t('saved'));}catch(err){state.error=message(err);}finally{state.saving=false;render();}},
  async delete(){const draft=state.draft;if(!await confirmDialog('deleteTitle',t('deleteHelp',{title:draft.title}),'delete',true))return;state.saving=true;render();try{await api(`/api/sets/${draft.id}?revision=${draft.revision}`,{method:'DELETE'});state.sets=state.sets.filter(s=>s.id!==draft.id);state.selected.delete(draft.id);state.draft=null;state.dirty=false;state.error='';}catch(err){state.error=message(err);}finally{state.saving=false;render();}},
  async logout(){if(!await discardGuard())return;try{await api('/api/logout',{method:'POST'});state.authenticated=false;state.draft=null;state.dirty=false;state.error='';render();}catch(err){toast(message(err));}},
  import:importDialog,
};
document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-nav]');if(nav){event.preventDefault();await navigate(nav.dataset.nav);return;}
  const button=event.target.closest('[data-action]');if(button && !button.disabled){try{await actions[button.dataset.action]?.(button);}catch(err){toast(message(err));}}
  if(event.detail>0 && event.target.closest('button'))document.activeElement?.closest('button')?.blur();
});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='search'){state.search=el.value;render();}else if(el.id==='custom-count')state.customValue=el.value;else if(el.id==='typed-answer')state.quiz.typed=el.value;else if(el.id==='set-title'){state.draft.title=el.value;markDirty();}else if(el.dataset.word!==undefined){state.draft.words[Number(el.dataset.word)][el.dataset.field]=el.value;markDirty();}});
document.addEventListener('change',event=>{const el=event.target;if(el.id==='language'){languageChoice=el.value;storage.set('wordnest-language',languageChoice);setLanguage();render();}else if(el.dataset.select){if(el.checked)state.selected.add(el.dataset.select);else state.selected.delete(el.dataset.select);render();}});
document.addEventListener('submit',async event=>{
  if(event.target.id==='answer-form'){event.preventDefault();if(!state.quiz.typed.trim())return;submitAnswer(state.quiz.typed);}
  if(event.target.id==='login-form'){event.preventDefault();if(state.saving)return;const password=new FormData(event.target).get('password');state.saving=true;state.error='';render();try{await api('/api/login',{method:'POST',body:JSON.stringify({password})});state.authenticated=true;state.error='';}catch(err){state.error=message(err);}finally{state.saving=false;render();}}
});
window.addEventListener('hashchange',()=>navigate(location.hash.startsWith('#/edit')?'edit':'home',true));
window.addEventListener('beforeunload',event=>{if(state.dirty||state.saving){event.preventDefault();event.returnValue='';}});
load();
