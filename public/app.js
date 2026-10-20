import { RankingClient, rankingMetrics } from './rankings.js';
import { PersonalWords, wordIdentity, catalogWord, findCatalogWord, sourceQuestions, collectionQuestions, canMultipleChoice, quizFromPool, collectionCards } from './personal.js';
import { LearningTracker, localDay } from './stats.js';
import { icon } from './icons.js';
import { normalize, studyKey, studyStatus, validateSet, questionPool, uniqueMeanings, createQuiz, createFlashcards, shuffle, isCorrect, portable, parseImport } from './core.js';
import { messages, translator } from './i18n.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate.js';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage = { get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, value); } catch {} } };
let learningStorage;try{learningStorage=localStorage;}catch{}
const personal=new PersonalWords(learningStorage);
const learning=new LearningTracker({storage:learningStorage,now:()=>Date.now()});
let languageChoice = storage.get('wordnest-language','auto');
if (!['auto','en','ja'].includes(languageChoice)) languageChoice = 'auto';
let lang, t;
function setLanguage() { lang = languageChoice === 'auto' ? (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en') : languageChoice; t = translator(lang); document.documentElement.lang = lang; }
setLanguage();
let themeChoice = storage.get('wordnest-theme', 'auto');
if (!['auto', 'light', 'dark'].includes(themeChoice)) themeChoice = 'auto';
const paletteChoices={light:['default','ocean','lavender'],dark:['default','midnight','graphite']};
let lightPalette=storage.get('wordnest-light-palette','default'),darkPalette=storage.get('wordnest-dark-palette','default');
if(!paletteChoices.light.includes(lightPalette))lightPalette='default';
if(!paletteChoices.dark.includes(darkPalette))darkPalette='default';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const theme = themeChoice === 'auto' ? (systemTheme.matches ? 'dark' : 'light') : themeChoice;
  const palette=theme==='dark'?darkPalette:lightPalette;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette=palette;
  const backgrounds={light:{default:'#f6f5f0',ocean:'#eef5fa',lavender:'#f5f2fa'},dark:{default:'#171d1a',midnight:'#111a27',graphite:'#1b1b1e'}};
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgrounds[theme][palette]);
}
applyTheme();
systemTheme.addEventListener?.('change', () => { if (themeChoice === 'auto') applyTheme(); });
const state = { sets: [], orderRevision:0, loaded:false, loadError:'', authenticated:false, sessionKnown:false, adminBusy:false, adminError:'', configured:true, rankingMetric:'totalMs', rankingData:null, rankingBusy:false, rankingError:'', adminData:null, adminStats:null, adminStatsId:null, adminStatsBusy:false, adminStatsError:'', adminSearch:'', adminStatus:'all', adminBusyList:false, adminListError:'', route:routeFromHash(), screen:'home', libraryTab:'sets', collection:null, weakScope:'single', weakMode:'en-ja', weakSetId:null, weakIds:null, weakPickerOpen:false, favoriteSet:'all', wordSearch:'', listLimit:100, selected:new Set(), search:'', setId:null, activity:'quiz', mode:null, order:'original', cards:null, count:5, countChoice:5, custom:false, customValue:'5', quiz:null, draft:null, dirty:false, error:'', saving:false };
const ranking=new RankingClient({storage:learningStorage,fetch:(...args)=>fetch(...args),snapshot:()=>{
  const snapshot=learning.snapshot();return {epoch:learning.epoch,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',days:snapshot.days};
},onChange:()=>{refreshRankingSettings();queueRankingNotice();if(state.route==='rankings')render();}});
let soundEnabled = storage.get('wordnest-sound','on') === 'on';
const sounds = Object.fromEntries(['correct','incorrect','confetti'].map(name => { const audio = new Audio(`/assets/audio/${name}.mp3`); audio.preload='auto'; return [name,audio]; }));
function play(name) { if (!soundEnabled) return; try { sounds[name].currentTime=0; sounds[name].play()?.catch(()=>{}); } catch {} }
const btn = (key, action, type='ghost', extra='') => `<button class="btn ${type}" data-action="${action}" ${extra}>${t(key)}</button>`;
let toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000); }
function message(error) { return t(messages.en[error.message] ? error.message : 'networkError'); }
async function api(path, options={}) {
  let response;
  try { response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}}); } catch { throw new Error('networkError'); }
  let data; try { data=await response.json(); } catch { throw new Error('serverError'); }
  if (!response.ok) { if (response.status===401) { state.authenticated=false;state.adminData=null;state.adminStats=null;state.adminStatsId=null;state.sessionKnown=true;render(); } throw new Error(data.error || 'serverError'); }
  return data;
}
async function load() {
  state.loadError=''; render();
  try { const [data, session]=await Promise.all([api('/api/sets'),api('/api/session')]); state.sets=data.sets; state.orderRevision=data.orderRevision; state.authenticated=session.authenticated; state.sessionKnown=true; state.configured=session.configured; state.loaded=true; }
  catch(error) { state.sessionKnown=true;state.loadError=message(error); }
  render();
  if(state.route==='rankings')refreshRankings();else ranking.sync(true).catch(()=>{});
  if(state.route==='admin' && state.authenticated)refreshAdministration();
  queueRankingNotice();setTimeout(maybeRankingOnboarding,0);
}
function routeFromHash() { return location.hash==='#/stats'?'stats':location.hash==='#/rankings'?'rankings':location.hash==='#/admin'?'admin':location.hash==='#/guide'?'guide':location.hash.startsWith('#/edit')?'edit':'home'; }
const routeHref=route=>route==='home'?'#/':`#/${route}`;
function shell(content) {
  return `<div class="app-shell"><aside class="sidebar"><a href="#/" data-nav="home" class="brand"><span class="brand-mark">${icon('book')}</span>wordnest<span style="color:var(--accent)">.</span></a><nav class="nav ${state.authenticated?'nav-admin':''}" style="--nav-count:${state.authenticated?6:4}" aria-label="${t('home')}"><a href="#/" data-nav="home" class="${state.route==='home'?'active':''}">${icon('book')}${t('home')}</a><a href="#/stats" data-nav="stats" class="${state.route==='stats'?'active':''}">${icon('stats')}${t('stats')}</a><a href="#/rankings" data-nav="rankings" class="${state.route==='rankings'?'active':''}">${icon('trophy')}${t('rankings')}</a><a href="#/guide" data-nav="guide" class="${state.route==='guide'?'active':''}">${icon('guide')}${t('guide')}</a>${state.authenticated?`<a href="#/edit" data-nav="edit" class="${state.route==='edit'?'active':''}">${icon('edit')}${t('edit')}</a><a href="#/admin" data-nav="admin" class="${state.route==='admin'?'active':''}">${icon('settings')}${t('admin')}</a>`:''}</nav><div class="sidebar-bottom"><button class="settings-trigger" data-action="settings">${icon('settings')}${t('settings')}</button></div></aside><main class="main">${content}</main></div>`;
}
function isTextEntry(element) {
  return element?.tagName==='TEXTAREA' || (element?.tagName==='INPUT' && ['text','search','email','password','tel','url','number'].includes(element.type));
}
function render() {
  learning.tick();
  if(state.sessionKnown && ['edit','admin'].includes(state.route) && !state.authenticated){state.route='home';state.screen='home';state.quiz=null;state.cards=null;state.collection=null;history.replaceState(null,'',routeHref('home'));}
  if($('#weak-picker'))state.weakPickerOpen=$('#weak-picker').open;
  document.title=`Wordnest — ${t(state.route==='home'?'home':state.route)}`;
  const active = document.activeElement;
  const focusId = isTextEntry(active) ? active.id : null;
  const selection = active && typeof active.selectionStart==='number' ? [active.selectionStart,active.selectionEnd] : null;
  let content;
  if (state.route==='stats') content=statsView();
  else if (state.route==='rankings') content=rankingsView();
  else if (state.route==='admin') content=administrationView();
  else if (state.route==='guide') content=guideView();
  else if (state.loadError) content=`<div class="empty"><h2>${e(state.loadError)}</h2>${btn('retry','reload','primary')}</div>`;
  else if (!state.loaded) content=`<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
  else if (state.route==='edit') content=editor();
  else if (state.screen==='activity') content=activities();
  else if (state.screen==='order') content=orders();
  else if (state.screen==='cards') content=cardsView();
  else if (state.screen==='mode') content=modes();
  else if (state.screen==='count') content=counts();
  else if (state.screen==='quiz') content=quizView();
  else if (state.screen==='result') content=resultView();
  else content=home();
  $('#app').innerHTML=shell(content);
  syncLearning();
  refreshAdminSettings();
  refreshRankingSettings();
  if(state.screen!=='quiz' || state.route!=='home')stopQuizClock();
  if (focusId) { const el=document.getElementById(focusId); if(el && document.activeElement!==el){el.focus({preventScroll:true});if(selection && el.setSelectionRange)el.setSelectionRange(...selection);} }
}
function learningScreen() { return state.route==='home' && ['quiz','cards'].includes(state.screen); }
function syncLearning() { learning.setActive(learningScreen() && document.visibilityState==='visible' && document.hasFocus() && !$('#modal')?.open); }
function formatDuration(milliseconds) {
  const seconds=Math.floor(milliseconds/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return hours?t('durationHours',{h:hours,m:minutes,s:rest}):minutes?t('durationMinutes',{m:minutes,s:rest}):t('durationSeconds',{s:rest});
}
function formatStudyMetric(metric,value) {
  if(value===null || value===undefined)return '—';
  const number=value=>new Intl.NumberFormat(lang==='ja'?'ja-JP':'en-US').format(value);
  if(['totalMs','averageMs'].includes(metric))return formatDuration(value);
  if(metric==='accuracy')return new Intl.NumberFormat(lang==='ja'?'ja-JP':'en-US',{style:'percent',maximumFractionDigits:1}).format(value);
  if(['streak','longest'].includes(metric))return t(value===1?'oneDay':'dayCount',{n:number(value)});
  return number(value);
}
function rankingsView() {
  const prefs=ranking.preferences(),joined=prefs?.choice==='joined',data=state.rankingData,metric=state.rankingMetric;
  const rowMarkup=(row,mine=false)=>`<tr class="${mine?'ranking-self':''}" ${mine?'aria-label="'+e(t('rankingYou'))+'"':''}><td>${row.rank}</td><td><span class="ranking-name">${e(row.name)}</span>${mine?`<span class="ranking-you">${t('rankingYou')}</span>`:''}</td><td>${e(formatStudyMetric(metric,row.value))}</td></tr>`;
  const selfId=prefs?.id,rows=data?.metric===metric?data.rows:[],mine=joined && data?.metric===metric?data.mine:null;
  return `<section class="rankings-view"><h1>${t('rankings')}</h1><div class="ranking-profile"><div><p>${joined?e(t('rankingAs',{name:prefs.name})):t(prefs?.notice?'rankingRemovedTitle':'rankingNotParticipating')}</p><small>${t(prefs?.pending?'rankingPending':prefs?.notice?'rankingRejoinHelp':'rankingBrowser')}</small></div><button class="btn ghost small" data-action="ranking-name">${icon('edit')}${t(joined?'rankingChangeName':'rankingJoin')}</button></div><div class="ranking-controls"><label for="ranking-metric">${t('rankingMetric')}<select id="ranking-metric">${Object.entries(rankingMetrics).map(([value,key])=>`<option value="${value}" ${metric===value?'selected':''}>${t(key)}</option>`).join('')}</select></label><button class="btn ghost small" data-action="ranking-refresh" ${state.rankingBusy?'disabled':''}>${icon('refresh')}${t('refreshRankings')}</button></div><p class="ranking-note">${t(metric==='accuracy'?'rankingAccuracyRule':metric==='averageMs'?'rankingAverageRule':'rankingUpdateRule')}</p>${state.rankingError?`<p class="error" role="alert">${e(t(state.rankingError))}</p>`:''}${state.rankingBusy?`<p class="ranking-loading" role="status">${t('rankingLoading')}</p>`:''}${rows.length?`<div class="ranking-table-wrap"><table class="ranking-table"><caption class="visually-hidden">${t(rankingMetrics[metric])}</caption><thead><tr><th scope="col">${t('rankingPosition')}</th><th scope="col">${t('rankingDisplayName')}</th><th scope="col">${t('rankingRecord')}</th></tr></thead><tbody>${rows.filter(row=>joined || row.id!==selfId).map(row=>rowMarkup(row,joined && row.id===selfId)).join('')}</tbody></table></div>`:!state.rankingBusy?`<div class="empty"><p>${t('rankingEmpty')}</p></div>`:''}${mine && !rows.some(row=>row.id===mine.id)?`<div class="ranking-own"><h2>${t('rankingYourPosition')}</h2><table class="ranking-table"><tbody>${rowMarkup(mine,true)}</tbody></table></div>`:''}${joined && !mine && data?.metric===metric && !state.rankingBusy?`<p class="ranking-note">${t(metric==='accuracy'?'rankingAccuracyPending':'rankingNoRecord')}</p>`:''}<p class="ranking-note">${t('rankingTop100',{n:data?.total || 0})}</p></section>`;
}
let rankingRequest=0;
async function refreshRankings(synchronize=true) {
  const request=++rankingRequest,metric=state.rankingMetric;state.rankingBusy=true;state.rankingError='';if(state.route==='rankings')render();
  let syncError='';
  try{
    if(synchronize)try{await ranking.sync(true);}catch(error){syncError=messages.en[error.message]?error.message:'networkError';}
    const data=await ranking.list(metric);if(request!==rankingRequest)return;
    state.rankingData=data;state.rankingError=syncError;
  }catch(error){if(request===rankingRequest)state.rankingError=messages.en[error.message]?error.message:'networkError';}
  finally{if(request===rankingRequest){state.rankingBusy=false;if(state.route==='rankings')render();}}
}
let rankingNoticeTimer,showingRankingNotice=false;
const deferredRankingNotices=new Set();
function queueRankingNotice(){
  const notice=ranking.preferences()?.notice;
  if(!notice || notice.acknowledged || deferredRankingNotices.has(notice.id) || showingRankingNotice)return;
  clearTimeout(rankingNoticeTimer);rankingNoticeTimer=setTimeout(showRankingNotice,0);
}
async function showRankingNotice(){
  const notice=ranking.preferences()?.notice;
  if(!notice || notice.acknowledged || deferredRankingNotices.has(notice.id) || showingRankingNotice)return;
  if(modal.open){rankingNoticeTimer=setTimeout(showRankingNotice,500);return;}
  showingRankingNotice=true;
  try{
    await dialog(`<h2 id="modal-title" tabindex="-1">${t('rankingRemovedTitle')}</h2><p>${t('rankingRemovedIntro')}</p><div class="moderation-notice" lang="${notice[lang]?lang:notice.ja?'ja':'en'}">${e(notice[lang] || notice.ja || notice.en)}</div><p>${t('rankingRejoinHelp')}</p><p class="error" id="ranking-notice-error" role="alert" hidden></p><div class="modal-actions"><button class="btn ghost" data-notice-later>${t('noticeLater')}</button><button class="btn primary" data-notice-confirm>${t('noticeConfirm')}</button></div>`,finish=>{
      let busy=false;
      modal.oncancel=event=>{event.preventDefault();if(!busy){deferredRankingNotices.add(notice.id);finish(false);}};
      modal.onclick=async event=>{
        if(busy)return;
        if(event.target.closest('[data-notice-later]')){deferredRankingNotices.add(notice.id);finish(false);return;}
        if(!event.target.closest('[data-notice-confirm]'))return;
        busy=true;$$('button',modal).forEach(button=>button.disabled=true);
        try{await ranking.acknowledgeNotice(notice.id);finish(true);}
        catch(error){if(error.message==='rankingConflict')await ranking.sync(true).catch(()=>{});const current=ranking.preferences()?.notice;if(!current || current.id!==notice.id || current.acknowledged){finish(false);return;}const alert=$('#ranking-notice-error',modal);alert.textContent=message(error);alert.hidden=false;}
        finally{busy=false;$$('button',modal).forEach(button=>button.disabled=false);}
      };
    });
  }finally{showingRankingNotice=false;queueRankingNotice();}
}
function administrationView(){
  if(!state.authenticated)return '';
  if(state.adminStatsId)return administratorStatsView();
  const data=state.adminData,participants=state.adminData?.participants || [];
  const date=value=>value?new Intl.DateTimeFormat(lang==='ja'?'ja-JP':'en-US',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';
  return `<section class="administration-view"><h1>${t('admin')}</h1><p class="ranking-note">${t('adminHelp')}</p><div class="admin-controls"><label for="admin-search">${t('adminSearch')}<input id="admin-search" type="search" maxlength="100" value="${e(state.adminSearch)}"></label><label for="admin-status">${t('adminStatus')}<select id="admin-status">${['all','listed','private','removed'].map(status=>`<option value="${status}" ${state.adminStatus===status?'selected':''}>${t({all:'adminAll',listed:'adminListed',private:'adminPrivate',removed:'adminRemoved'}[status])}</option>`).join('')}</select></label><button class="btn ghost small" data-action="admin-refresh" ${state.adminBusyList?'disabled':''}>${icon('refresh')}${t('refreshRankings')}</button></div>${state.adminListError?`<p class="error" role="alert">${e(t(state.adminListError))}</p>`:''}${state.adminBusyList?`<p class="ranking-note" role="status">${t('loading')}</p>`:''}<div class="admin-participants">${participants.map(person=>`<article class="admin-participant"><div class="admin-person-head"><div><h2>${e(person.name)}</h2><small>${e(t('adminUpdated',{date:date(person.updatedAt)}))}</small><small class="admin-person-id">${e(person.id.slice(0,12))}</small></div><div class="admin-person-actions"><button class="btn ghost small" data-action="admin-stats" data-id="${e(person.id)}">${icon('stats')}${t('adminViewStats')}</button>${person.removed?`<span class="pill">${t(person.acknowledged?'noticeRead':'noticeUnread')}</span>`:person.enabled?`<button class="btn danger small" data-action="admin-remove" data-id="${e(person.id)}">${icon('trash')}${t('adminRemove')}</button>`: `<span class="pill">${t('adminPrivate')}</span>`}</div></div>${person.removed?`<dl class="admin-messages">${person.messageJa?`<dt>${t('moderationMessageJa')}</dt><dd lang="ja">${e(person.messageJa)}</dd>`:''}${person.messageEn?`<dt>${t('moderationMessageEn')}</dt><dd lang="en">${e(person.messageEn)}</dd>`:''}</dl>`:''}</article>`).join('') || (!state.adminBusyList?`<div class="empty"><p>${t('adminEmpty')}</p></div>`:'')}</div>${data && participants.length<data.total?`<button class="btn ghost" data-action="admin-more" ${state.adminBusyList?'disabled':''}>${t('adminMore')}</button>`:''}</section>`;
}
function studyMetricCards(data){
  const symbols={totalMs:'timer',averageMs:'calendar',answered:'quiz',correct:'check',accuracy:'target',flips:'flip',streak:'flame',longest:'trophy'};
  return `<div class="stats-grid">${Object.entries(rankingMetrics).map(([metric,key])=>`<article class="stat-card"><h2>${icon(symbols[metric])}${t(key)}</h2><p data-stat="${key}">${e(formatStudyMetric(metric,data[metric]))}</p>${key==='averageTime'?`<small>${t(data.activeDays===1?'averageOneDay':'averageDays',{n:new Intl.NumberFormat(lang).format(data.activeDays)})}</small>`:''}</article>`).join('')}</div>`;
}
function administratorStatsView(){
  const data=state.adminStats,person=data?.participant;
  const date=person?new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short',timeZone:person.timezone}).format(new Date(person.updatedAt)):'';
  return `<section class="administration-view admin-stats-view"><div class="actions"><button class="btn ghost small" data-action="admin-stats-back">${icon('back')}${t('adminBack')}</button><button class="btn ghost small" data-action="admin-stats-refresh" ${state.adminStatsBusy?'disabled':''}>${icon('refresh')}${t('refreshRankings')}</button></div><h1>${t('stats')}</h1>${person?`<h2 class="admin-stats-name">${e(person.name)}</h2><p class="ranking-note">${e(t('adminUpdated',{date}))}<br>${e(t('adminStatsTimezone',{timezone:person.timezone}))}</p>`:''}<p class="ranking-note">${t('adminStatsScope')}</p>${state.adminStatsBusy?`<p role="status">${t('loading')}</p>`:''}${state.adminStatsError?`<p class="error" role="alert">${e(t(state.adminStatsError))}</p>`:''}${data?studyMetricCards(data.summary):''}</section>`;
}
let administratorStatsRequest=0;
async function refreshAdministratorStats(){
  if(!state.authenticated || !state.adminStatsId)return;
  const id=state.adminStatsId,request=++administratorStatsRequest;
  state.adminStats=null;state.adminStatsBusy=true;state.adminStatsError='';render();
  try{
    const data=await api('/api/admin/rankings/'+id+'/stats');
    if(state.authenticated && state.adminStatsId===id && request===administratorStatsRequest)state.adminStats=data;
  }catch(error){if(request===administratorStatsRequest)state.adminStatsError=messages.en[error.message]?error.message:'networkError';}
  finally{if(request===administratorStatsRequest){state.adminStatsBusy=false;if(state.route==='admin')render();}}
}
let administrationRequest=0;
async function refreshAdministration(append=false){
  if(!state.authenticated)return;
  const request=++administrationRequest,previous=append?state.adminData?.participants || []:[];
  state.adminBusyList=true;state.adminListError='';if(!append)state.adminData=null;if(state.route==='admin')render();
  try{
    const query=new URLSearchParams({status:state.adminStatus,q:state.adminSearch,offset:String(previous.length)}),data=await api('/api/admin/rankings?'+query);
    if(request===administrationRequest && state.authenticated)state.adminData={...data,participants:[...previous,...data.participants]};
  }catch(error){if(request===administrationRequest)state.adminListError=messages.en[error.message]?error.message:'networkError';}
  finally{if(request===administrationRequest){state.adminBusyList=false;if(state.route==='admin')render();}}
}
async function removeRankingParticipant(button){
  if(!state.authenticated || state.route!=='admin')return;
  const person=state.adminData?.participants.find(person=>person.id===button.dataset.id);if(!person)return;
  const removed=await dialog(`<button class="icon-btn modal-close" data-moderation-close aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${e(t('adminRemoveTitle',{name:person.name}))}</h2><p>${t('adminRemoveHelp')}</p><form id="moderation-form" class="moderation-form"><label for="moderation-ja">${t('moderationMessageJa')}<textarea id="moderation-ja" maxlength="1000" lang="ja" placeholder="${e(t('moderationExampleJa'))}"></textarea></label><label for="moderation-en">${t('moderationMessageEn')}<textarea id="moderation-en" maxlength="1000" lang="en" placeholder="${e(t('moderationExampleEn'))}"></textarea></label><small>${t('moderationMessageHelp')}</small><p class="error" id="moderation-error" role="alert" hidden></p><div class="modal-actions"><button class="btn ghost" type="button" data-moderation-close>${t('cancel')}</button><button class="btn danger" type="submit">${t('adminRemoveConfirm')}</button></div></form>`,finish=>{
    let busy=false;
    modal.oncancel=event=>{event.preventDefault();if(!busy)finish(false);};
    modal.onclick=event=>{if(event.target.closest('[data-moderation-close]') && !busy)finish(false);};
    modal.onsubmit=async event=>{
      if(event.target.id!=='moderation-form')return;event.preventDefault();if(busy)return;
      const messageJa=$('#moderation-ja').value.trim(),messageEn=$('#moderation-en').value.trim(),alert=$('#moderation-error');
      if((!messageJa && !messageEn) || [...messageJa].length>500 || [...messageEn].length>500){alert.textContent=t('invalidRankingMessage');alert.hidden=false;return;}
      busy=true;$$('button,textarea',modal).forEach(element=>element.disabled=true);alert.hidden=true;
      try{await api('/api/admin/rankings/'+person.id+'/remove',{method:'POST',body:JSON.stringify({revision:person.revision,name:person.name,messageJa,messageEn})});finish(true);}
      catch(error){alert.textContent=message(error);alert.hidden=false;}
      finally{busy=false;$$('button,textarea',modal).forEach(element=>element.disabled=false);}
    };
  });
  if(removed){toast(t('adminRemovalSaved'));await refreshAdministration();ranking.sync(true).catch(()=>{});}
}
let rankingOnboardingStarted=false;
function maybeRankingOnboarding(){
  if(rankingOnboardingStarted || ranking.preferences())return;
  if(modal.open){setTimeout(maybeRankingOnboarding,500);return;}
  rankingOnboardingStarted=true;rankingNameDialog(true);
}
async function rankingNameDialog(initial=false,privateOnly=false){
  let prefs=ranking.preferences();
  if(!privateOnly && prefs?.notice && !prefs.notice.acknowledged){deferredRankingNotices.delete(prefs.notice.id);await showRankingNotice();prefs=ranking.preferences();if(prefs?.notice && !prefs.notice.acknowledged)return;}
  await dialog(`<button class="icon-btn modal-close" data-ranking-name-close aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t(privateOnly?'profileChangeName':prefs?.choice==='joined'?'rankingChangeName':'rankingJoinTitle')}</h2><p>${t(privateOnly?'privateNameHelp':'rankingNameHelp')}</p><p>${t('learningSyncHelp')}</p>${prefs?.notice && !privateOnly?`<p>${t('rankingRejoinHelp')}</p>`:''}<form id="ranking-name-form" class="ranking-name-form"><label for="ranking-name">${t('profileName')}<input id="ranking-name" name="name" value="${e(prefs?.name || '')}" autocomplete="nickname" maxlength="40" required></label><small>${t('rankingNameLimit')}</small><p class="error" id="ranking-name-error" role="alert" hidden></p><div class="modal-actions"><button class="btn ghost" type="button" data-ranking-name-close>${t(initial?'rankingDecline':'cancel')}</button><button class="btn primary" type="submit">${t(privateOnly?'save':'rankingSaveName')}</button></div></form>`,finish=>{
    let busy=false;
    const close=async()=>{
      if(busy)return;if(!initial){finish(false);return;}
      busy=true;const alert=$('#ranking-name-error');alert.hidden=true;$$('button',modal).forEach(button=>button.disabled=true);
      try{await ranking.decline($('#ranking-name').value);finish('declined');}
      catch(error){if(error.message==='invalidRankingName'){alert.textContent=message(error);alert.hidden=false;}else{finish('declined');toast(message(error));}}
      finally{busy=false;$$('button',modal).forEach(button=>button.disabled=false);}
    };
    modal.oncancel=event=>{event.preventDefault();close();};
    modal.onclick=event=>{if(event.target.closest('[data-ranking-name-close]'))close();};
    modal.onsubmit=async event=>{
      if(event.target.id!=='ranking-name-form')return;event.preventDefault();if(busy)return;
      busy=true;const input=$('#ranking-name'),error=$('#ranking-name-error'),submit=$('[type="submit"]',modal);submit.disabled=true;error.hidden=true;
      try{await (privateOnly?ranking.rename(input.value):ranking.join(input.value));finish(ranking.preferences()?.notice?'removed':'joined');}
      catch(err){error.textContent=message(err);error.hidden=false;}
      finally{busy=false;if(submit.isConnected)submit.disabled=false;}
    };
  });
  if(state.route==='rankings')await refreshRankings();
}
function rankingSettingsSignature(){const prefs=ranking.preferences();return JSON.stringify([prefs?.choice,prefs?.name,prefs?.pending,ranking.error,lang]);}
function rankingSettingsContent(){
  const prefs=ranking.preferences(),joined=prefs?.choice==='joined';
  return `<h3 id="ranking-settings-title">${t('rankingParticipation')}</h3><p>${t(prefs?.pending?'rankingPending':prefs?.notice?'rankingRejoinHelp':joined?'rankingEnabledHelp':'rankingDisabledHelp')}</p><p>${t('learningSyncHelp')}</p>${prefs?.name?`<small>${e(t('profileAs',{name:prefs.name}))}</small>`:''}<button class="btn ghost" data-ranking-private-name>${t('profileChangeName')}</button><button class="btn ghost" data-ranking-settings aria-pressed="${joined}">${t(joined?'rankingDisable':'rankingEnable')}</button>`;
}
function refreshRankingSettings(){const section=$('#ranking-settings');if(section && section.dataset.state!==rankingSettingsSignature()){section.innerHTML=rankingSettingsContent();section.dataset.state=rankingSettingsSignature();}}
let statsRenderedDay;
function statsView() {
  statsRenderedDay=localDay(Date.now());
  const data=learning.snapshot(),locale=lang==='ja'?'ja-JP':'en-US';
  const maximum=Math.max(...data.recent.map(day=>day.ms),1),dateFormat=new Intl.DateTimeFormat(locale,{month:'numeric',day:'numeric'});
  return `<section class="stats-view"><h1>${t('stats')}</h1><p class="stats-note">${t('statsLocal')}</p>${!learning.persistent?`<p class="error" role="status">${t('statsStorageError')}</p>`:''}${studyMetricCards(data)}<section class="stats-chart" aria-labelledby="recent-time"><h2 id="recent-time">${t('recentTime')}</h2><ol class="stats-bars">${data.recent.map(day=>{const [year,month,date]=day.date.split('-').map(Number),label=dateFormat.format(new Date(year,month-1,date));return `<li><span class="bar-value">${e(formatDuration(day.ms))}</span><span class="bar-track" aria-hidden="true"><span style="height:${day.ms?Math.max(2,day.ms/maximum*100):0}%"></span></span><time datetime="${day.date}">${e(label)}</time></li>`;}).join('')}</ol></section><div class="stats-details"><p>${t('statsTimeRule')}</p><p>${t('statsCountRule')}</p><p>${t('statsStreakRule')}</p></div></section>`;
}
function guideView() {
  const section=(id,symbol,title,items)=>`<section class="guide-section" aria-labelledby="${id}"><h2 id="${id}">${icon(symbol)}${t(title)}</h2><ul>${items.map(key=>`<li>${e(t(key))}</li>`).join('')}</ul></section>`;
  return `<article class="guide-view"><h1>${t('guideTitle')}</h1>${section('guide-quiz','quiz','quiz',['guideQuizStart','guideQuizModes','guideQuizTimer','guideQuizResults'])}${section('guide-cards','cards','flashcards',['guideCardsStart','guideCardsControls'])}<section class="guide-section" aria-labelledby="guide-clears"><h2 id="guide-clears">${icon('trophy')}${t('guideClearTitle')}</h2><p>${t('guideClearRule')}</p><ul class="guide-legend">${['none','en-ja','ja-en','both'].map(status=>`<li class="study-${status}"><span class="guide-swatch">${icon('book')}</span><span>${e(t(status==='none'?'notCleared':status==='both'?'bothCleared':'directionCleared',{direction:status==='en-ja'?'EN → JP':'JP → EN'}))}</span></li>`).join('')}</ul><p>${t('guideClearStorage')}</p><p>${t('guideClearEdits')}</p></section>${section('guide-personal','star','personalTools',['guideWeak','guideWeakRecovery','guideFavorites','guideSearch','guidePersonalStorage'])}${section('guide-records','stats','stats',['guideStats','statsTimeRule','statsCountRule','statsStreakRule'])}${section('guide-rankings','trophy','rankings',['guideRankings','rankingAccuracyRule','guideRankingPrivacy'])}${section('guide-settings','settings','settings',['guideSettings','guideDeleteData','guideSounds'])}${state.authenticated?section('guide-edit','edit','edit',['guideEditAccess','guideEditManage','guideTransfers','guideEditShared'])+section('guide-admin','settings','admin',['guideAdministration']):''}</article>`;
}
function readStudyProgress() {
  try { const value=JSON.parse(storage.get('wordnest-progress','{}'));return value && typeof value==='object' && !Array.isArray(value)?value:{}; } catch { return {}; }
}
function recordQuizClear(quiz) {
  if(quiz.origin!=='set' || !quiz.allSelected || quiz.isRetry)return;
  const set=state.sets.find(set=>set.id===quiz.setId);
  if(!set || studyKey(set)!==quiz.setKey)return;
  const progress=readStudyProgress(),previous=progress[set.id];
  const sameContent=previous?.scope==='all-first-pass' && previous.key===quiz.setKey;
  progress[set.id]={key:quiz.setKey,scope:'all-first-pass','en-ja':sameContent && previous['en-ja']===true,'ja-en':sameContent && previous['ja-en']===true,[quiz.mode]:true};
  storage.set('wordnest-progress',JSON.stringify(progress));
}
function setCard(set,progress) {
  const status=studyStatus(set,progress),label=status==='none'?t('notCleared'):status==='both'?t('bothCleared'):t('directionCleared',{direction:status==='en-ja'?'EN → JP':'JP → EN'});
  return `<article class="set-card study-${status}" data-study-status="${status}" data-set-id="${e(set.id)}"><div class="card-head"><span class="set-symbol">${icon('book')}</span><span class="study-status">${status==='none'?'':icon(status==='both'?'trophy':'check')}${e(label)}</span></div><button class="card-open" data-action="open" data-id="${e(set.id)}"><h3>${e(set.title)}</h3><span class="visually-hidden">${t('openSet')}</span></button><div class="card-bottom"><span>${t('wordsCount',{n:set.words.length})}</span><button class="icon-btn" data-action="open" data-id="${e(set.id)}" aria-label="${t('openSet')}">${icon('arrow')}</button></div></article>`;
}
function libraryTabs() {
  return `<nav class="library-tabs" aria-label="${t('studyTools')}">${[['sets','setsTab'],['weak','weakWords'],['favorites','favorites'],['words','wordSearch']].map(([tab,label])=>`<button data-action="library-tab" data-tab="${tab}" aria-pressed="${state.libraryTab===tab}">${t(label)}</button>`).join('')}</nav>`;
}
function home() { return `${libraryTabs()}${state.libraryTab!=='sets' && !personal.persistent?`<p class="error" role="status">${t('personalStorageError')}</p>`:''}${state.libraryTab==='weak'?weakView():state.libraryTab==='favorites'?favoritesView():state.libraryTab==='words'?wordSearchView():setsView()}`; }
function globalWordBank() {return state.sets.flatMap(set=>set.words);}
function globalMeanings() { return [...new Map(state.sets.flatMap(set=>set.words.map(word=>[normalize(word.meaning),word.meaning]))).values()]; }
function activeTitle() {return state.collection?t(state.collection.kind==='weak'?'weakWords':'favorites'):currentSet()?.title || '';}
function activePool(mode=state.mode) {return state.collection?state.collection.pools[mode] || []:sourceQuestions([currentSet()],mode);}
function activeMeanings() {return state.collection?globalMeanings():uniqueMeanings(currentSet());}
function activeCards(order='original') {
  if(state.collection)return collectionCards(state.collection.kind==='weak'?state.collection.pools[state.mode]:state.collection.words,state.mode,order);
  const set=currentSet();return createFlashcards(set,state.mode,order).map(card=>({...card,wordRefs:[catalogWord(set,card)]}));
}
function favoriteButton(word,showWord=false) {
  const on=personal.favorite(word.wordKey),label=t(on?'removeFavorite':'addFavorite',{word:word.english,set:word.setTitle});
  return `<button class="favorite-toggle" data-action="favorite" data-word-key="${e(word.wordKey)}" data-show-word="${showWord}" aria-pressed="${on}" aria-label="${e(label)}" title="${e(label)}">${icon('star')}${showWord?`<span>${e(word.english)}</span>`:''}</button>`;
}
function favoriteActions(words=[]) { const unique=[...new Map(words.map(word=>[word.wordKey,word])).values()];return `<div class="favorite-actions">${unique.map(word=>favoriteButton(word,unique.length>1)).join('')}</div>`; }
function sourceNames(item) {return [...new Set(item.sources?.map(source=>source.setTitle) || item.wordRefs?.map(word=>word.setTitle) || [])].join(' · ');}
function collectionButtons(kind,disabled=false,pool=[]) {
  const noChoices=kind==='weak' && state.weakMode==='en-ja' && !canMultipleChoice(pool,globalMeanings(),globalWordBank());
  return `<div class="collection-actions"><button class="btn primary" data-action="start-collection" data-kind="${kind}" data-activity="quiz" ${disabled || noChoices?'disabled':''}>${icon('quiz')}${t('quiz')}</button><button class="btn ghost" data-action="start-collection" data-kind="${kind}" data-activity="cards" ${disabled?'disabled':''}>${icon('cards')}${t('flashcards')}</button></div>${noChoices?`<p class="notice">${t('needFour')}</p>`:''}`;
}
function weakSetIds() {
  const ids=state.sets.map(set=>set.id);
  if(state.weakScope==='combined'){
    if(state.weakIds===null)state.weakIds=new Set(ids);
    return new Set([...state.weakIds].filter(id=>ids.includes(id)));
  }
  if(!ids.includes(state.weakSetId))state.weakSetId=state.sets.find(set=>sourceQuestions([set],state.weakMode).some(question=>personal.record(question.sources[0].key).weak))?.id || ids[0];
  return new Set(state.weakSetId?[state.weakSetId]:[]);
}
function weakPool() {return collectionQuestions(state.sets,state.weakMode,{kind:'weak',selectedIds:weakSetIds(),record:key=>personal.record(key)});}
function weakView() {
  const selected=weakSetIds(),pool=weakPool(),counts=new Map(state.sets.map(set=>[set.id,sourceQuestions([set],state.weakMode).filter(question=>personal.record(question.sources[0].key).weak).length]));
  return `<section class="personal-view"><h1>${t('weakWords')}</h1><p class="personal-help">${t('weakRuleShort')}</p><div class="personal-controls"><div class="segmented">${['single','combined'].map(scope=>`<button data-action="weak-scope" data-scope="${scope}" aria-pressed="${state.weakScope===scope}">${t(scope==='single'?'bySet':'combineSets')}</button>`).join('')}</div><div class="segmented">${['en-ja','ja-en'].map(mode=>`<button data-action="weak-mode" data-mode="${mode}" aria-pressed="${state.weakMode===mode}">${mode==='en-ja'?'EN → JP':'JP → EN'}</button>`).join('')}</div></div>${state.weakScope==='single'?`<label class="personal-filter">${t('wordSet')}<select id="weak-set">${state.sets.map(set=>`<option value="${e(set.id)}" ${selected.has(set.id)?'selected':''}>${e(set.title)} (${counts.get(set.id)})</option>`).join('')}</select></label>`:`<details id="weak-picker" class="collection-picker" ${state.weakPickerOpen?'open':''}><summary>${t('selectedSets',{n:selected.size})}</summary><button class="text-btn" data-action="weak-select-all">${t(selected.size===state.sets.length?'clearSelection':'selectAll')}</button><div class="collection-checks">${state.sets.map((set,index)=>`<label><input id="weak-set-${index}" type="checkbox" data-weak-set="${e(set.id)}" ${selected.has(set.id)?'checked':''}><span>${e(set.title)} <small>(${counts.get(set.id)})</small></span></label>`).join('')}</div></details>`}${collectionButtons('weak',!pool.length,pool)}<div class="personal-list-heading"><h2>${t('questionsCount',{n:pool.length})}</h2></div><div class="word-list">${pool.slice(0,state.listLimit).map(question=>{const records=question.sources.map(source=>personal.record(source.key)),mistakes=records.reduce((sum,record)=>sum+record.mistakes,0),successes=Math.min(...records.map(record=>record.successes));return `<article class="word-item"><div class="word-main"><strong>${e(state.weakMode==='ja-en'?question.accepted.join(' / '):question.english)}</strong><p>${e(question.meaning)}</p><small>${e(sourceNames(question))}</small><div class="word-progress"><span>${t('mistakeCount',{n:mistakes})}</span><span>${t('recoveryCount',{n:successes})}</span></div></div>${favoriteActions(question.wordRefs)}</article>`;}).join('')}</div>${!pool.length?`<div class="empty"><h2>${t('noWeakWords')}</h2></div>`:''}${moreWords(pool.length)}</section>`;
}
function favoriteWords() {
  if(state.favoriteSet!=='all' && !state.sets.some(set=>set.id===state.favoriteSet))state.favoriteSet='all';
  return state.sets.filter(set=>state.favoriteSet==='all' || set.id===state.favoriteSet).flatMap(set=>set.words.filter(word=>personal.favorite(wordIdentity(set.id,word))).map(word=>catalogWord(set,word)));
}
function moreWords(total) {return total>state.listLimit?`<div class="center-actions"><button class="btn ghost" data-action="more-words">${t('showMore')}</button></div>`:'';}
function wordRow(word) {
  return `<article class="word-item"><button class="word-main word-detail" data-action="word-detail" data-word-key="${e(word.wordKey)}"><strong>${e(word.english)}</strong><p>${e(word.meaning)}</p><small>${e(word.setTitle)}</small></button>${favoriteButton(word)}</article>`;
}
function favoritesView() {
  const words=favoriteWords();return `<section class="personal-view"><h1>${t('favorites')}</h1><label class="personal-filter">${t('wordSet')}<select id="favorite-set"><option value="all">${t('allSets')}</option>${state.sets.map(set=>`<option value="${e(set.id)}" ${state.favoriteSet===set.id?'selected':''}>${e(set.title)}</option>`).join('')}</select></label>${collectionButtons('favorites',!words.length)}<div class="personal-list-heading"><h2>${t('wordsCount',{n:words.length})}</h2></div><div class="word-list">${words.slice(0,state.listLimit).map(wordRow).join('')}</div>${!words.length?`<div class="empty"><h2>${t('noFavorites')}</h2><p>${t('favoritesHint')}</p></div>`:''}${moreWords(words.length)}</section>`;
}
function wordSearchView() {
  const query=normalize(state.wordSearch),matches=[];
  if(query)for(const set of state.sets)for(const word of set.words)if(normalize(word.english).includes(query) || normalize(word.meaning).includes(query))matches.push(catalogWord(set,word));
  return `<section class="personal-view"><h1>${t('wordSearch')}</h1><div class="search personal-search">${icon('search')}<input id="word-search" type="search" value="${e(state.wordSearch)}" placeholder="${t('searchWords')}" aria-label="${t('searchWords')}"></div>${query?`<div class="personal-list-heading"><h2>${t('wordsCount',{n:matches.length})}</h2></div><div class="word-list">${matches.slice(0,state.listLimit).map(wordRow).join('')}</div>${!matches.length?`<div class="empty"><h2>${t('noMatchingWords')}</h2></div>`:''}${moreWords(matches.length)}`:`<p class="notice">${t('searchWordsHint')}</p>`}</section>`;
}
function buildCollection(kind) {
  if(kind==='weak'){
    const pool=weakPool();return {kind,title:t('weakWords'),pools:{[state.weakMode]:pool},words:[],mode:state.weakMode};
  }
  const words=favoriteWords(),keys=new Set(words.map(word=>word.wordKey)),selectedIds=new Set(words.map(word=>word.setId));
  return {kind,title:t('favorites'),words,pools:Object.fromEntries(['en-ja','ja-en'].map(mode=>[mode,collectionQuestions(state.sets,mode,{kind:'favorites',selectedIds,favorite:key=>keys.has(key)})]))};
}
function prepareCount() {const max=activePool().length;state.count=Math.min(5,max);state.countChoice=max<5?'all':5;state.custom=false;state.error='';}
async function wordDetail(button) {
  const word=findCatalogWord(state.sets,button.dataset.wordKey);if(!word)return;
  await dialog(`<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${e(word.english)}</h2><p class="word-detail-meaning">${e(word.meaning)}</p><p class="muted">${e(word.setTitle)}</p>${word.explanation?`<div class="word-detail-explanation"><small>${t('explanation')}</small><p>${e(word.explanation)}</p></div>`:''}<div class="modal-actions">${favoriteButton(word,true)}<button class="btn primary" data-dialog="cancel">${t('close')}</button></div>`);
}

function setsView() {
  const visible=state.sets.filter(s=>normalize(s.title).includes(normalize(state.search))),progress=readStudyProgress();
  return `<section class="library-view"><div class="section-bar"><div class="section-heading"><h1>${t('library')}</h1><span class="count">${t('setsCount',{n:state.sets.length})}</span></div><button class="icon-btn" data-action="reload" aria-label="${t('refresh')}">${icon('refresh')}</button></div><div class="toolbar"><div class="search">${icon('search')}<input id="search" type="search" placeholder="${t('search')}" aria-label="${t('search')}" value="${e(state.search)}"></div></div><div class="grid">${visible.map(set=>setCard(set,progress)).join('')}</div>${!visible.length?`<div class="empty"><h2>${t(state.sets.length?'noResults':'empty')}</h2>${!state.sets.length?`<p>${t('emptyHelp')}</p>`:''}</div>`:''}</section>`;
}
const currentSet=()=>state.sets.find(s=>s.id===state.setId);
function flowTitle(title) { return `<div class="flow-title"><p class="set-context">${e(activeTitle())}</p><h1>${t(title)}</h1></div>`; }
function activities() {
  return `<section class="flow"><button class="back" data-action="back-home">${icon('back')}${t('chooseSet')}</button>${flowTitle('chooseActivity')}<div class="mode-grid"><button class="mode-card" data-action="activity" data-activity="cards"><span class="activity-icon">${icon('cards')}</span><h3>${t('flashcards')}</h3><p>${t('flashcardsHelp')}</p></button><button class="mode-card" data-action="activity" data-activity="quiz"><span class="activity-icon">${icon('quiz')}</span><h3>${t('quiz')}</h3><p>${t('quizHelp')}</p></button></div></section>`;
}
function modes() {
  const set=currentSet(); if(!set && !state.collection) {state.screen='home';return home();}
  const cards=state.activity==='cards',enough=cards || canMultipleChoice(activePool('en-ja'),activeMeanings(),state.collection?globalWordBank():[]);
  return `<section class="flow"><button class="back" data-action="back-activity">${icon('back')}${t('back')}</button>${flowTitle('chooseDirection')}<div class="mode-grid"><button class="mode-card" data-action="mode" data-mode="en-ja" ${!enough?'disabled':''}><span class="direction">EN<span class="arrow">${icon('arrow')}</span>JP</span><h3>${t(cards?'englishFront':'choice')}</h3><p>${t(cards?'englishFrontHelp':'choiceHelp')}</p></button><button class="mode-card" data-action="mode" data-mode="ja-en"><span class="direction">JP<span class="arrow">${icon('arrow')}</span>EN</span><h3>${t(cards?'japaneseFront':'typing')}</h3><p>${t(cards?'japaneseFrontHelp':'typingHelp')}</p></button></div>${!enough?`<p class="notice">${t('needFour')}</p>`:''}</section>`;
}
function orders() {
  return `<section class="flow"><button class="back" data-action="back-mode">${icon('back')}${t('back')}</button>${flowTitle('chooseOrder')}<span class="pill">${state.mode==='en-ja'?'EN → JP':'JP → EN'}</span><div class="order-grid">${['original','reverse','random'].map(order=>`<button class="mode-card ${state.order===order?'active':''}" data-action="order" data-order="${order}" aria-pressed="${state.order===order}"><h3>${t(order+'Order')}</h3><p>${t(order+'OrderHelp')}</p></button>`).join('')}</div><div class="flow-bottom"><span class="count">${t('wordsCount',{n:activeCards().length})}</span><button class="btn primary" data-action="start-cards">${t('startCards')}${icon('arrow')}</button></div></section>`;
}
function cardsView() {
  const deck=state.cards,card=deck.items[deck.index],frontLang=deck.mode==='en-ja'?'en':'ja',backLang=deck.mode==='en-ja'?'ja':'en';
  return `<section class="flashcards-view"><div class="quiz-meta"><span>${e(state.collection?activeTitle():deck.title)} · ${deck.mode==='en-ja'?'EN → JP':'JP → EN'}</span><button class="text-btn" data-action="back-order">${t('changeOrder')}</button></div><div class="progress" role="progressbar" aria-label="${t('flashcards')}" aria-valuenow="${deck.index+1}" aria-valuemin="0" aria-valuemax="${deck.items.length}"><span style="width:${(deck.index+1)/deck.items.length*100}%"></span></div><div class="quiz-meta" style="margin-bottom:16px"><span id="card-counter" aria-live="polite">${t('cardOf',{n:deck.index+1,total:deck.items.length})}</span><span>${t(deck.order+'Order')}</span></div><div class="card-tools"><small>${state.collection?e(sourceNames(card)):''}</small>${favoriteActions(card.wordRefs)}</div><button class="flashcard ${deck.flipped?'is-flipped':''}" data-action="flip-card" aria-pressed="${deck.flipped}" aria-label="${e(t('flipCardLabel',{word:deck.flipped?card.back:card.front}))}"><span class="flashcard-inner"><span class="flashcard-face flashcard-front" aria-hidden="${deck.flipped}"><span class="eyebrow">${t(deck.mode==='en-ja'?'word':'meaning')}</span><span class="flashcard-text" lang="${frontLang}">${e(card.front)}</span><span class="flashcard-hint">${icon('flip')}${t('tapToFlip')}</span></span><span class="flashcard-face flashcard-back" aria-hidden="${!deck.flipped}"><span class="eyebrow">${t(deck.mode==='en-ja'?'meaning':'word')}</span><span class="flashcard-text" lang="${backLang}">${e(card.back)}</span><span class="flashcard-hint">${icon('flip')}${t('tapToFlipBack')}</span></span></span></button><div class="flashcard-controls"><button class="btn ghost" data-action="previous-card" ${deck.index===0?'disabled':''}>${icon('back')}${t('previousWord')}</button><span class="count">${deck.index+1} / ${deck.items.length}</span><button class="btn green" data-action="next-card" ${deck.index===deck.items.length-1?'disabled':''}>${t('nextWord')}${icon('arrow')}</button></div><p class="swipe-hint">${t('swipeHelp')}</p>${deck.flipped && card.explanation?`<div class="card-explanation"><small>${t('explanation')}</small><p>${e(card.explanation)}</p></div>`:''}<div class="center-actions cards-exit">${btn('returnHome','back-home','ghost')}</div></section>`;
}
function moveCard(direction) {
  const deck=state.cards;if(state.screen!=='cards' || !deck)return;
  const next=deck.index+direction;if(next<0 || next>=deck.items.length)return;
  deck.index=next;deck.flipped=false;render();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) $('.flashcard')?.animate?.([{transform:`translateX(${direction*45}px)`,opacity:.3},{transform:'translateX(0)',opacity:1}],{duration:180,easing:'ease-out'});
}
function flipCard() {
  if(state.screen!=='cards' || !state.cards)return;
  state.cards.flipped=!state.cards.flipped;learning.flip();
  const card=$('.flashcard'),item=state.cards.items[state.cards.index];
  card.classList.toggle('is-flipped',state.cards.flipped);card.setAttribute('aria-pressed',String(state.cards.flipped));card.setAttribute('aria-label',t('flipCardLabel',{word:state.cards.flipped?item.back:item.front}));
  $('.flashcard-front',card).setAttribute('aria-hidden',String(state.cards.flipped));$('.flashcard-back',card).setAttribute('aria-hidden',String(!state.cards.flipped));
  $('.card-explanation')?.remove();
  if(state.cards.flipped && item.explanation){const block=document.createElement('div');block.className='card-explanation';block.innerHTML=`<small>${t('explanation')}</small><p>${e(item.explanation)}</p>`;$('.cards-exit').before(block);}
}

function counts() {
  const max=activePool().length;
  return `<section class="flow"><button class="back" data-action="back-mode">${icon('back')}${t('back')}</button>${flowTitle('chooseCount')}<span class="pill">${state.mode==='en-ja'?'EN → JP':'JP → EN'}</span><div class="count-grid">${[5,10,15,'all','custom'].map(n=>`<button class="count-btn ${n==='custom'?state.custom?'active':'':!state.custom && state.countChoice===n?'active':''}" data-action="count" data-count="${n}" ${typeof n==='number'&&n>max?'disabled':''}>${typeof n==='number'?n:t(n)}</button>`).join('')}</div>${state.custom?`<label class="custom-count" for="custom-count">${t('countLabel')}<input id="custom-count" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="${e(state.customValue)}"></label>`:''}${state.error?`<p class="error" role="alert">${e(state.error)}</p>`:''}<p class="notice">${t(state.collection?'collectionClearExcluded':'clearAllOnly')}</p><div class="flow-bottom"><span class="count">${t('available',{n:max})} · ${t('timePerQuestion')}</span><button class="btn primary" data-action="start">${t('start')}${icon('arrow')}</button></div></section>`;
}
const QUESTION_TIME_MS=15000;
let quizClock=null;
function stopQuizClock(){if(quizClock!==null){clearInterval(quizClock);quizClock=null;}}
function startQuestionClock(){
  stopQuizClock();state.quiz.deadline=Date.now()+QUESTION_TIME_MS;state.quiz.remainingMs=QUESTION_TIME_MS;
  quizClock=setInterval(updateQuizClock,50);
}
function timeLeft(quiz){return Math.max(0,Math.min(QUESTION_TIME_MS,quiz.deadline-Date.now()));}
function timerMarkup(quiz,result){
  const remaining=result?quiz.remainingMs:timeLeft(quiz),seconds=Math.ceil(remaining/1000),ratio=remaining/QUESTION_TIME_MS;
  return `<div class="question-timer ${result?'is-stopped':''} ${result?.timedOut?'is-expired':''}" style="--timer-hue:${Math.round(ratio*120)}"><div class="timer-meta"><span>${icon('timer')}${t(result?.timedOut?'timedOut':'timeRemaining')}</span><span class="timer-seconds" role="timer" aria-live="off">${t('secondsShort',{n:seconds})}</span></div><div class="timer-track" role="progressbar" aria-label="${t('timeRemaining')}" aria-valuemin="0" aria-valuemax="15" aria-valuenow="${seconds}" aria-valuetext="${t('secondsRemaining',{n:seconds})}"><span class="timer-fill" style="transform:scaleX(${ratio})"></span></div></div>`;
}
function updateQuizClock(){
  const quiz=state.quiz;
  if(state.route!=='home' || state.screen!=='quiz' || !quiz || quiz.answers[quiz.index]){stopQuizClock();return;}
  quiz.remainingMs=timeLeft(quiz);
  if(quiz.remainingMs<=0){submitAnswer(quiz.typed||'',false,true);return;}
  const timer=$('.question-timer');if(!timer)return;
  const ratio=quiz.remainingMs/QUESTION_TIME_MS,seconds=Math.ceil(quiz.remainingMs/1000);
  timer.style.setProperty('--timer-hue',String(Math.round(ratio*120)));
  $('.timer-fill',timer).style.transform=`scaleX(${ratio})`;
  $('.timer-seconds',timer).textContent=t('secondsShort',{n:seconds});
  const track=$('.timer-track',timer);track.setAttribute('aria-valuenow',String(seconds));track.setAttribute('aria-valuetext',t('secondsRemaining',{n:seconds}));
}

function quizView() {
  const qz=state.quiz,q=qz.questions[qz.index],result=qz.answers[qz.index];
  return `<section class="quiz"><div class="quiz-meta"><span>${e(qz.origin==='set'?qz.title:t(qz.origin==='weak'?'weakWords':'favorites'))} · ${qz.mode==='en-ja'?'EN → JP':'JP → EN'}${qz.isRetry?' · '+t('retryRound'):''}</span><button class="text-btn" data-action="quit">${t('quit')}</button></div>${timerMarkup(qz,result)}<div class="progress" role="progressbar" aria-label="${t('questions')}" aria-valuenow="${qz.index+Number(!!result)}" aria-valuemin="0" aria-valuemax="${qz.questions.length}"><span style="width:${(qz.index+Number(!!result))/qz.questions.length*100}%"></span></div><div class="quiz-meta" style="margin-bottom:16px"><span>${t('questionOf',{n:qz.index+1,total:qz.questions.length})}</span><span>${t('correctCount',{n:qz.answers.filter(a=>a.correct).length})}</span></div><div class="question-card"><div class="eyebrow">${t(qz.mode==='en-ja'?'meaningPrompt':'englishPrompt')}</div>${qz.origin!=='set'?`<small class="question-source">${e(sourceNames(q))}</small>`:''}<div class="question-word" ${qz.mode==='en-ja'?'lang="en"':'lang="ja"'}>${e(q.prompt)}</div></div>${qz.mode==='en-ja'?`<div class="options">${q.options.map((option,i)=>`<button class="option ${result?(normalize(option)===normalize(q.answer)?'correct':option===result.answer?'wrong':''):''}" data-action="answer" data-option="${i}" ${result?'disabled':''}><span class="letter">${'ABCD'[i]}</span><span lang="ja">${e(option)}</span></button>`).join('')}</div>`:`<form id="answer-form" class="typing-form"><label class="visually-hidden" for="typed-answer">${t('englishPrompt')}</label><input id="typed-answer" lang="en" name="answer" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="${t('answerPlaceholder')}" value="${e(qz.typed||'')}" ${result?'disabled':''}><button class="btn primary" type="submit" ${result?'disabled':''}>${t('check')}</button></form>`}${result?`<div class="feedback ${result.correct?'':'wrong'}" role="status"><h3>${t(result.timedOut?'timedOut':result.correct?'correct':'incorrect')}</h3><p>${t('correctAnswer')}: <strong>${e(qz.mode==='ja-en'?q.accepted.join(' / '):q.answer)}</strong></p>${!result.correct?`<p>${t('yourAnswer')}: ${e(result.answer||t('skipped'))}</p>`:''}${q.explanation?`<small>${t('explanation')}</small><p>${e(q.explanation)}</p>`:''}${favoriteActions(q.wordRefs)}</div>`:''}<div class="quiz-actions">${!result?btn('skip','skip','ghost'):btn(qz.index===qz.questions.length-1?'results':'next','next','green')}</div></section>`;
}
function resultView() {
  const qz=state.quiz,correct=qz.answers.filter(a=>a.correct).length,missed=qz.questions.length-correct,perfect=missed===0;
  return `<section class="flow"><div class="result-hero">${qz.isRetry?`<span class="pill">${t('retryRound')}</span>`:''}<div class="result-medal">${icon(perfect?'trophy':'leaf')}</div><h1>${t(perfect?'perfect':'completed')}</h1><div class="score-number">${correct}<small> / ${qz.questions.length}</small></div><span class="pill">${Math.round(correct/qz.questions.length*100)}%</span></div><div class="center-actions">${missed?`<button class="btn primary" data-action="retry-mistakes">${icon('refresh')}${t('retryMistakes',{n:missed})}</button>`:''}${btn('again','again',missed?'ghost':'primary')}${btn('returnHome','back-home')}</div><div class="review"><h2>${t('review')}</h2>${qz.questions.map((q,i)=>{const a=qz.answers[i];return `<div class="review-item"><span class="verdict ${a.correct?'':'bad'}" aria-label="${t(a.correct?'correctLabel':'incorrectLabel')}">${icon(a.correct?'check':'close')}</span><div><strong>${e(q.english)} — ${e(q.meaning)}</strong>${!a.correct?`<p>${a.timedOut?t('timedOut')+' · ':''}${t('yourAnswer')}: ${e(a.answer||t('skipped'))}</p>`:''}${qz.mode==='ja-en' && q.accepted.length>1?`<p>${t('correctAnswer')}: ${e(q.accepted.join(' / '))}</p>`:''}${q.explanation?`<p>${e(q.explanation)}</p>`:''}</div></div>`}).join('')}</div></section>`;
}
function editor() {
  if(!state.authenticated)return '';
  const draft=state.draft;
  return `<section><div class="edit-heading"><h1>${t('editTitle')}</h1></div><div class="toolbar editor-toolbar"><div class="actions"><button class="btn primary small" data-action="new">${icon('plus')}${t('newSet')}</button><button class="btn ghost small" data-action="import">${icon('upload')}${t('import')}</button><button class="btn ghost small" data-action="export" ${!state.sets.length?'disabled':''}>${icon('download')}${t('export')}</button><button class="btn ghost small" data-action="manage-sets">${icon('sort')}${t('manageSets')}</button></div></div><div class="editor-layout"><aside class="set-list" aria-label="${t('library')}">${state.sets.map(s=>`<button class="${draft?.id===s.id?'active':''}" data-action="edit-set" data-id="${e(s.id)}">${e(s.title)}<small>${t('wordsCount',{n:s.words.length})}</small></button>`).join('')}</aside><div class="editor-panel ${state.saving?'busy':''}">${draft?`<label for="set-title">${t('title')}<input id="set-title" maxlength="150" value="${e(draft.title)}" placeholder="${t('setTitlePlaceholder')}"></label><div class="row"><span class="count">${t('wordsCount',{n:draft.words.length})}</span></div><div class="editor-words">${draft.words.map((w,i)=>`<article class="word-row"><div class="word-row-head"><span>${t('wordNumber',{n:i+1})}</span><button class="icon-btn" data-action="remove-word" data-index="${i}" aria-label="${t('removeWord')}">${icon('trash')}</button></div><div class="word-fields"><label for="word-${i}-english">${t('word')}<input id="word-${i}-english" data-word="${i}" data-field="english" lang="en" value="${e(w.english)}" maxlength="150" placeholder="${t('englishPlaceholder')}" autocapitalize="none" spellcheck="false"></label><label for="word-${i}-meaning">${t('meaning')}<input id="word-${i}-meaning" data-word="${i}" data-field="meaning" value="${e(w.meaning)}" maxlength="300" placeholder="${t('meaningPlaceholder')}"></label><label class="wide" for="word-${i}-explanation">${t('explanation')} · ${t('optional')}<textarea id="word-${i}-explanation" data-word="${i}" data-field="explanation" maxlength="2000" placeholder="${t('explanationPlaceholder')}">${e(w.explanation)}</textarea></label></div></article>`).join('')}</div><button class="btn ghost" data-action="add-word" ${draft.words.length>=1000?'disabled':''}>${icon('plus')}${t('addWord')}</button>${state.error?`<p class="error" role="alert">${e(state.error)}</p>`:''}<div class="editor-actions"><span class="muted" id="dirty-label">${state.dirty?t('unsaved'):''}</span><button class="btn ghost" data-action="export-draft">${icon('download')}${t('draftExport')}</button><button class="btn primary" data-action="save" ${state.saving?'disabled':''}>${icon('check')}${t(state.saving?'saving':'save')}</button></div>`:`<div class="empty"><p>${t('editorEmpty')}</p></div>`}</div></div></section>`;
}
const modal=$('#modal');
function dialog(content, setup) {
  return new Promise(resolve=>{
    const previous=document.activeElement;
    modal.innerHTML=content;
    modal.setAttribute('aria-labelledby','modal-title');
    let settled=false;
    const finish=value=>{ if(settled)return; settled=true; modal.close();syncLearning(); modal.oncancel=null; modal.onclick=null; modal.onchange=null; modal.onsubmit=null; if(previous?.isConnected){if(isTextEntry(previous))previous.focus({preventScroll:true});else if(document.activeElement===previous)previous.blur();} resolve(value); };
    modal.oncancel=event=>{event.preventDefault();finish(false);};
    modal.onclick=event=>{const button=event.target.closest('[data-dialog]');if(button)finish(button.dataset.dialog==='confirm');};
    learning.setActive(false);modal.showModal(); $('#modal-title',modal)?.focus({preventScroll:true});
    setup?.(finish);
  });
}
function confirmDialog(title,help,confirm='discard',danger=false) {
  return dialog(`<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t(title)}</h2><p>${e(help)}</p><div class="modal-actions"><button class="btn ghost" data-dialog="cancel">${t('cancel')}</button><button class="btn ${danger?'danger':'primary'}" data-dialog="confirm">${t(confirm)}</button></div>`);
}
async function discardGuard() { return !state.dirty || await confirmDialog('unsavedTitle',t('unsavedHelp'),'discard',true); }
async function navigate(route, fromHistory=false) {
  if(state.saving)return;
  if(['edit','admin'].includes(route) && !state.authenticated){route='home';if(fromHistory)history.replaceState(null,'',routeHref(route));}
  const resumeDraft=route==='edit' && state.route!=='edit' && state.dirty && state.draft;
  if(!resumeDraft && !await discardGuard()) { if(fromHistory)history.pushState(null,'',routeHref(state.route));return; }
  if(state.screen==='quiz' && !await confirmDialog('quitTitle',t('quitHelp'),'confirmQuit')) { if(fromHistory)history.pushState(null,'',routeHref(state.route));return; }
  if(route!==state.route){administratorStatsRequest++;state.adminStatsId=null;state.adminStats=null;state.adminStatsBusy=false;state.adminStatsError='';}
  state.route=route;state.collection=null;state.screen='home';state.quiz=null;state.cards=null;if(!resumeDraft){state.dirty=false;state.draft=null;state.error='';}
  if(!fromHistory)history.pushState(null,'',routeHref(route));
  render();window.scrollTo(0,0);
  if(route==='rankings')await refreshRankings();else ranking.sync().catch(()=>{});
  if(route==='admin' && state.authenticated)await refreshAdministration();
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
function synchronizeSetOrder(data) {
  state.orderRevision=data.orderRevision;
  if(Array.isArray(data.orderedIds)){const positions=new Map(data.orderedIds.map((id,index)=>[id,index]));state.sets.sort((a,b)=>(positions.get(a.id)??Number.MAX_SAFE_INTEGER)-(positions.get(b.id)??Number.MAX_SAFE_INTEGER));}
}
async function deleteSavedSet(set) {
  const data=await api(`/api/sets/${set.id}?revision=${set.revision}`,{method:'DELETE'});
  state.sets=state.sets.filter(s=>s.id!==set.id);state.selected.delete(set.id);synchronizeSetOrder(data);
  if(state.draft?.id===set.id){state.draft=null;state.dirty=false;state.error='';}
}
async function manageSetsDialog() {
  if(state.route!=='edit' || !state.authenticated)return;
  let ids=state.sets.map(s=>s.id),baseline=[...ids],pendingDelete=null,confirmClose=false,error='',busy=false,revision=state.orderRevision;
  const changed=()=>ids.join(',')!==baseline.join(',');
  function content(){
    const set=state.sets.find(s=>s.id===pendingDelete);
    return `<button class="icon-btn modal-close" data-manage-close aria-label="${t('close')}" ${busy?'disabled':''}>${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t('manageSets')}</h2>${confirmClose?`<div class="manage-confirm"><h3>${t('unsavedTitle')}</h3><p>${t('orderUnsavedHelp')}</p><div class="modal-actions"><button class="btn ghost" data-manage-keep>${t('keepEditing')}</button><button class="btn danger" data-manage-discard>${t('discard')}</button></div></div>`:set?`<div class="manage-confirm"><h3>${t('deleteTitle')}</h3><p>${e(t('deleteHelp',{title:set.title}))}</p>${state.draft?.id===set.id && state.dirty?`<p>${t('deleteDraftHelp')}</p>`:''}<div class="modal-actions"><button class="btn ghost" data-manage-cancel ${busy?'disabled':''}>${t('cancel')}</button><button class="btn danger" data-manage-delete-confirm ${busy?'disabled':''}>${t(busy?'deleting':'delete')}</button></div></div>`:`<p>${t('manageSetsHelp')}</p><div class="manage-set-list">${ids.map((id,index)=>{const entry=state.sets.find(s=>s.id===id);return `<div class="manage-set-row" data-manage-row="${e(id)}"><span class="manage-position">${index+1}</span><span class="manage-set-title">${e(entry.title)}<small>${t('wordsCount',{n:entry.words.length})}</small></span><div class="manage-controls"><button class="icon-btn" data-manage-up="${e(id)}" aria-label="${e(t('moveSetUp',{title:entry.title}))}" ${index===0||busy?'disabled':''}>${icon('up')}</button><button class="icon-btn" data-manage-down="${e(id)}" aria-label="${e(t('moveSetDown',{title:entry.title}))}" ${index===ids.length-1||busy?'disabled':''}>${icon('down')}</button><button class="icon-btn manage-delete" data-manage-delete="${e(id)}" aria-label="${e(t('deleteNamedSet',{title:entry.title}))}" ${busy?'disabled':''}>${icon('trash')}</button></div></div>`}).join('') || `<div class="empty"><p>${t('noSetsToManage')}</p></div>`}</div><div class="modal-actions"><button class="btn ghost" data-manage-close ${busy?'disabled':''}>${t('close')}</button><button class="btn primary" id="save-set-order" ${!changed()||busy?'disabled':''}>${t(busy?'saving':'saveOrder')}</button></div>`}${error?`<p class="error" role="alert">${e(error)}</p>`:''}`;
  }
  await dialog(content(),finish=>{
    function refresh(){const scroll=$('.manage-set-list',modal)?.scrollTop||0;modal.innerHTML=content();const list=$('.manage-set-list',modal);if(list)list.scrollTop=scroll;}
    function close(){if(busy)return;if(changed()){pendingDelete=null;confirmClose=true;refresh();}else finish(false);}
    modal.oncancel=event=>{event.preventDefault();close();};
    modal.onclick=async event=>{
      const button=event.target.closest('button');if(!button||button.disabled||busy)return;
      if(button.hasAttribute('data-manage-close')){close();return;}
      if(button.hasAttribute('data-manage-keep')){confirmClose=false;refresh();return;}
      if(button.hasAttribute('data-manage-discard')){finish(false);return;}
      if(button.hasAttribute('data-manage-cancel')){pendingDelete=null;error='';refresh();return;}
      const up=button.dataset.manageUp,down=button.dataset.manageDown;
      if(up||down){const from=ids.indexOf(up||down),to=from+(up?-1:1);if(from<0||to<0||to>=ids.length)return;[ids[from],ids[to]]=[ids[to],ids[from]];error='';refresh();return;}
      if(button.dataset.manageDelete){pendingDelete=button.dataset.manageDelete;error='';refresh();return;}
      if(button.hasAttribute('data-manage-delete-confirm')){
        busy=true;state.saving=true;error='';refresh();
        try{const set=state.sets.find(s=>s.id===pendingDelete);await deleteSavedSet(set);if(state.orderRevision===revision+1)revision=state.orderRevision;else error=t('orderConflict');ids=ids.filter(id=>id!==set.id);baseline=baseline.filter(id=>id!==set.id);pendingDelete=null;toast(t('setDeleted'));}
        catch(err){error=message(err);}
        finally{busy=false;state.saving=false;refresh();}
        return;
      }
      if(button.id==='save-set-order'){
        busy=true;state.saving=true;error='';refresh();
        try{const saved=await api('/api/sets/order',{method:'PUT',body:JSON.stringify({ids,revision})});state.orderRevision=saved.orderRevision;revision=saved.orderRevision;const entries=new Map(state.sets.map(s=>[s.id,s]));state.sets=ids.map(id=>entries.get(id));baseline=[...ids];toast(t('orderSaved'));}
        catch(err){error=message(err);}
        finally{busy=false;state.saving=false;refresh();}
      }
    };
  });
  render();
}

function adminSignature() { return JSON.stringify([state.authenticated,state.configured,state.adminBusy,state.adminError,lang]); }
function adminSettingsContent() {
  const heading=`<h3 id="admin-settings-title">${t('adminAccess')}</h3>`;
  if(state.authenticated)return `${heading}<p class="admin-status" role="status">${icon('check')}${t('unlocked')}</p><small>${t('sessionNote')}</small><div class="settings-buttons"><button class="btn primary" data-admin-open>${icon('edit')}${t('openEditor')}</button><button class="btn ghost" data-admin-lock>${icon('lock')}${t('logout')}</button></div>`;
  if(!state.configured)return `${heading}<p>${t('adminUnavailable')}</p>`;
  return `${heading}<form id="admin-login-form"><label for="admin-password">${t('adminPassword')}<input type="password" id="admin-password" name="password" autocomplete="current-password" required minlength="12" maxlength="512" ${state.adminBusy?'disabled':''}></label>${state.adminError?`<p class="error" role="alert">${e(t(state.adminError))}</p>`:''}<button class="btn primary" type="submit" ${state.adminBusy?'disabled':''}>${icon('lock')}${t(state.adminBusy?'adminChecking':'adminUnlock')}</button></form>`;
}
function refreshAdminSettings() {
  const controls=$('#admin-controls');
  if(controls && controls.dataset.state!==adminSignature()){controls.innerHTML=adminSettingsContent();controls.dataset.state=adminSignature();}
}
async function submitAdmin(form) {
  if(state.adminBusy || state.authenticated || !state.configured)return;
  const password=new FormData(form).get('password');
  form.reset();state.adminBusy=true;state.adminError='';refreshAdminSettings();
  try { await api('/api/login',{method:'POST',body:JSON.stringify({password})});state.authenticated=true;state.sessionKnown=true; }
  catch(error) { state.adminError=messages.en[error.message]?error.message:'networkError'; }
  finally { state.adminBusy=false;render(); }
}
const learningDataTypes={
  clears:{label:'clearData',help:'clearDataHelp'},
  weak:{label:'weakWords',help:'weakDataHelp'},
  favorites:{label:'favorites',help:'favoriteDataHelp'},
  statistics:{label:'stats',help:'statisticsDataHelp'},
  all:{label:'allLearningData',help:'allLearningDataHelp'}
};
function settingsDataContent() {
  return `<section class="settings-section settings-data" aria-labelledby="learning-data-title"><h3 id="learning-data-title">${t('deleteLearningData')}</h3><p class="settings-data-note">${t('learningDataScope')}</p><div class="settings-data-list">${Object.entries(learningDataTypes).filter(([type])=>type!=='all').map(([type,{label}])=>`<div class="settings-data-row"><span>${t(label)}</span><button class="btn ghost small" data-delete-learning="${type}" aria-label="${e(t('deleteNamedData',{name:t(label)}))}">${t('delete')}</button></div>`).join('')}</div><button class="btn danger" data-delete-learning="all">${icon('trash')}${t('deleteAllLearningData')}</button></section>`;
}
async function deleteLearningData(type) {
  const target=learningDataTypes[type];if(!target)return;
  const confirmed=await dialog(`<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${e(t('deleteDataTitle',{name:t(target.label)}))}</h2><p>${t(target.help)}</p><p>${t('deleteDataWarning')}</p><div class="modal-actions"><button class="btn ghost" data-dialog="cancel">${t('cancel')}</button><button class="btn danger" data-dialog="confirm">${t('delete')}</button></div>`);
  if(!confirmed)return;
  try {
    if(type==='clears' || type==='all'){if(!learningStorage)throw new Error('Storage unavailable');learningStorage.removeItem('wordnest-progress');}
    if(type==='weak' || type==='all')personal.reset('question');
    if(type==='favorites' || type==='all')personal.reset('favorite');
    if(type==='statistics' || type==='all'){learning.reset();try{await ranking.sync(true);}catch{toast(t('rankingResetPending'));}}
    render();toast(t(ranking.error && ['statistics','all'].includes(type)?'rankingResetPending':'learningDataDeleted'));
  } catch {render();toast(t('deleteDataError'));}
}
function settingsContent() {
  return `<button class="icon-btn modal-close" data-dialog="cancel" aria-label="${t('close')}">${icon('close')}</button><h2 id="modal-title" tabindex="-1">${t('settings')}</h2><div class="settings-section"><label for="theme-choice">${t('appearance')}<select id="theme-choice">${['auto','light','dark'].map(value=>`<option value="${value}" ${themeChoice===value?'selected':''}>${t(value)}</option>`).join('')}</select></label>${['light','dark'].map(mode=>`<label for="${mode}-palette">${t(mode==='light'?'lightTheme':'darkTheme')}<select id="${mode}-palette">${paletteChoices[mode].map(value=>`<option value="${value}" ${(mode==='light'?lightPalette:darkPalette)===value?'selected':''}>${t('palette_'+value)}</option>`).join('')}</select></label>`).join('')}<label for="settings-language">${t('language')}<select id="settings-language"><option value="auto" ${languageChoice==='auto'?'selected':''}>${t('auto')}</option><option value="en" ${languageChoice==='en'?'selected':''}>English</option><option value="ja" ${languageChoice==='ja'?'selected':''}>日本語</option></select></label><button class="btn ghost" data-settings-sound aria-pressed="${soundEnabled}">${icon(soundEnabled?'sound':'mute')}${t(soundEnabled?'soundOn':'soundOff')}</button></div><section class="settings-section" id="ranking-settings" aria-labelledby="ranking-settings-title" data-state="${e(rankingSettingsSignature())}">${rankingSettingsContent()}</section>${settingsDataContent()}<section class="settings-section settings-admin" id="admin-controls" aria-labelledby="admin-settings-title" data-state="${e(adminSignature())}">${adminSettingsContent()}</section><div class="modal-actions"><button class="btn primary" data-dialog="cancel">${t('close')}</button></div>`;
}
async function settingsDialog() {
  let scroll=0;
  while(true){
    state.adminError='';
    const action=await dialog(settingsContent(),finish=>{
      modal.scrollTop=scroll;
      modal.onchange=event=>{
        if(event.target.tagName==='SELECT' && event.target.value===({'theme-choice':themeChoice,'light-palette':lightPalette,'dark-palette':darkPalette,'settings-language':languageChoice})[event.target.id])return;
        if(event.target.id==='theme-choice'){themeChoice=event.target.value;storage.set('wordnest-theme',themeChoice);applyTheme();}
        else if(event.target.id==='light-palette'){lightPalette=event.target.value;storage.set('wordnest-light-palette',lightPalette);applyTheme();}
        else if(event.target.id==='dark-palette'){darkPalette=event.target.value;storage.set('wordnest-dark-palette',darkPalette);applyTheme();}
        else if(event.target.id==='settings-language'){languageChoice=event.target.value;storage.set('wordnest-language',languageChoice);setLanguage();render();modal.innerHTML=settingsContent();$('#modal-title',modal)?.focus({preventScroll:true});}
      };
      modal.onclick=event=>{
        const deletion=event.target.closest('[data-delete-learning]');
        if(event.target.closest('[data-ranking-private-name]')){finish('private-name');return;}
        if(event.target.closest('[data-ranking-settings]')){finish(ranking.preferences()?.choice==='joined'?'ranking-off':'ranking-name');return;}
        if(deletion){finish({deleteData:deletion.dataset.deleteLearning,scroll:modal.scrollTop});return;}
        if(event.target.closest('[data-admin-open]')){finish('edit');return;}
        if(event.target.closest('[data-admin-lock]')){finish('lock');return;}
        if(event.target.closest('[data-dialog]')){finish(false);return;}
        if(event.target.closest('[data-settings-sound]')){soundEnabled=!soundEnabled;storage.set('wordnest-sound',soundEnabled?'on':'off');modal.innerHTML=settingsContent();$('#modal-title',modal)?.focus({preventScroll:true});return;}
      };
    });
    if(action==='private-name'){await rankingNameDialog(false,true);continue;}
    if(action==='ranking-name'){await rankingNameDialog();continue;}
    if(action==='ranking-off'){ranking.decline().then(()=>{if(state.route==='rankings')refreshRankings(false);}).catch(error=>toast(message(error)));continue;}
    if(action?.deleteData){scroll=action.scroll;await deleteLearningData(action.deleteData);continue;}
    if(action==='edit' && state.authenticated)await navigate('edit');
    else if(action==='lock' && state.authenticated)await actions.logout();
    return;
  }
}
async function exportDialog() {
  if(state.route!=='edit' || !state.authenticated)return;
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
  if(state.route!=='edit' || !state.authenticated)return;
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
      try{const data=await api('/api/sets',{method:'POST',body:JSON.stringify({sets:imported.filter((_,i)=>selected.has(i))})});state.sets.unshift(...data.sets);synchronizeSetOrder(data);state.dirty=false;state.draft=structuredClone(data.sets[0]);toast(t('importDone',{n:data.sets.length}));finish(true);render();}
      catch(err){error.textContent=message(err);error.hidden=false;busy=false;submit.disabled=false;submit.textContent=t('importConfirm',{n:selected.size});$$('[data-dialog]',modal).forEach(b=>b.disabled=false);$('#import-files',modal).disabled=false;modal.oncancel=event=>{event.preventDefault();finish(false);};}
    };
  });
  render();
}
function submitAnswer(answer,skipped=false,forceTimeout=false) {
  const qz=state.quiz;if(!qz || state.screen!=='quiz' || qz.answers[qz.index])return;
  qz.remainingMs=timeLeft(qz);const timedOut=forceTimeout || qz.remainingMs<=0;
  if(timedOut)qz.remainingMs=0;
  stopQuizClock();
  const q=qz.questions[qz.index],correct=!timedOut && !skipped && isCorrect(q,answer,qz.mode);
  qz.answers[qz.index]={answer:answer.trim(),correct,timedOut};learning.answer(correct,timedOut?qz.deadline:Date.now());personal.answer(q.sources,correct);play(correct?'correct':'incorrect');render();
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
  'ranking-name':()=>rankingNameDialog(),
  'admin-refresh':()=>refreshAdministration(),
  'admin-more':()=>refreshAdministration(true),
  'admin-remove':removeRankingParticipant,
  'admin-stats':button=>{if(!state.authenticated || state.route!=='admin')return;state.adminStatsId=button.dataset.id;return refreshAdministratorStats();},
  'admin-stats-refresh':()=>refreshAdministratorStats(),
  'admin-stats-back':()=>{administratorStatsRequest++;state.adminStats=null;state.adminStatsId=null;state.adminStatsBusy=false;state.adminStatsError='';render();},
  'ranking-refresh':()=>refreshRankings(),
  'library-tab'(button){state.libraryTab=button.dataset.tab;state.listLimit=100;state.collection=null;render();},
  'weak-scope'(button){state.weakScope=button.dataset.scope;state.listLimit=100;render();},
  'weak-mode'(button){state.weakMode=button.dataset.mode;state.weakSetId=null;state.listLimit=100;render();},
  'weak-select-all'(){const selected=weakSetIds();state.weakIds=selected.size===state.sets.length?new Set():new Set(state.sets.map(set=>set.id));state.listLimit=100;render();},
  'more-words'(){state.listLimit+=100;render();},
  favorite(button){const word=findCatalogWord(state.sets,button.dataset.wordKey);if(!word)return;personal.toggleFavorite(word.wordKey);render();if(modal.open)$$('[data-action="favorite"]',modal).forEach(button=>{const ref=findCatalogWord(state.sets,button.dataset.wordKey);if(ref)button.outerHTML=favoriteButton(ref,button.dataset.showWord==='true');});},
  'word-detail':wordDetail,
  'start-collection'(button){state.collection=buildCollection(button.dataset.kind);state.activity=button.dataset.activity;state.error='';state.order='original';state.setId=null;if(state.collection.kind==='weak'){state.mode=state.collection.mode;prepareCount();state.screen=state.activity==='cards'?'order':'count';}else state.screen='mode';render();window.scrollTo(0,0);},
  'manage-sets':manageSetsDialog,
  sound(){soundEnabled=!soundEnabled;storage.set('wordnest-sound',soundEnabled?'on':'off');render();},
  async reload(){if(!await discardGuard())return;state.dirty=false;state.draft=null;state.selected.clear();state.loaded=false;state.screen='home';state.quiz=null;await load();},
  open(button){state.collection=null;state.setId=button.dataset.id;state.screen='activity';state.cards=null;state.error='';render();window.scrollTo(0,0);},
  'back-home'(){ranking.sync().catch(()=>{});state.collection=null;state.screen='home';state.quiz=null;state.cards=null;cancelAnimationFrame(confettiFrame);const c=$('#confetti');c.getContext('2d')?.clearRect(0,0,c.width,c.height);render();window.scrollTo(0,0);},
  'back-activity'(){if(state.collection){actions['back-home']();return;}state.screen='activity';state.error='';render();},
  activity(button){state.activity=button.dataset.activity;state.screen='mode';state.order='original';state.error='';render();},
  order(button){state.order=button.dataset.order;render();},
  'start-cards'(){state.cards={title:activeTitle(),mode:state.mode,order:state.order,index:0,flipped:false,items:activeCards(state.order)};state.screen='cards';render();window.scrollTo(0,0);},
  'back-order'(){state.screen='order';state.cards=null;render();},
  'flip-card':flipCard,
  'next-card'(){moveCard(1);},
  'previous-card'(){moveCard(-1);},
  'back-mode'(){if(state.collection?.kind==='weak'){actions['back-home']();return;}state.screen='mode';state.error='';render();},
  mode(button){state.mode=button.dataset.mode;if(state.activity==='cards'){state.screen='order';render();return;}state.screen='count';prepareCount();render();},
  count(button){const value=button.dataset.count;state.custom=value==='custom';if(!state.custom){state.countChoice=value==='all'?'all':Number(value);state.count=value==='all'?activePool().length:Number(value);}state.error='';render();},
  start(){const max=activePool().length,count=state.custom?Number(state.customValue):state.count;if(!Number.isInteger(count)||count<1||count>max){state.error=t('invalidCount',{n:max});render();return;}try{const set=currentSet(),origin=state.collection?.kind || 'set';state.quiz={origin,setId:origin==='set'?set.id:null,setKey:origin==='set'?studyKey(set):null,allSelected:origin==='set' && !state.custom && state.countChoice==='all' && count===max,title:activeTitle(),mode:state.mode,questions:quizFromPool(activePool(),state.mode,count,activeMeanings(),state.collection?globalWordBank():[]),index:0,answers:[],typed:''};state.screen='quiz';state.error='';startQuestionClock();render();window.scrollTo(0,0);}catch(err){state.error=message(err);render();}},
  answer(button){submitAnswer(state.quiz.questions[state.quiz.index].options[Number(button.dataset.option)]);},
  skip(){submitAnswer('',true);},
  next(){const qz=state.quiz;if(!qz.answers[qz.index])return;if(qz.index===qz.questions.length-1){state.screen='result';ranking.sync(true).catch(()=>{});const perfect=qz.answers.length===qz.questions.length && qz.answers.every(a=>a.correct);if(perfect)recordQuizClear(qz);render();if(perfect){play('confetti');confetti();}window.scrollTo(0,0);}else{qz.index++;qz.typed='';startQuestionClock();render();window.scrollTo(0,0);}},
  async quit(){if(await confirmDialog('quitTitle',t('quitHelp'),'confirmQuit'))actions['back-home']();},
  'retry-mistakes'(){
    const previous=state.quiz;if(state.screen!=='result' || !previous)return;
    const missed=previous.questions.filter((_,index)=>previous.answers[index] && !previous.answers[index].correct);
    if(!missed.length)return;
    const questions=shuffle(missed).map(question=>({...structuredClone(question),options:shuffle(question.options)}));
    state.quiz={origin:previous.origin,setId:previous.setId,setKey:previous.setKey,allSelected:previous.allSelected,title:previous.title,mode:previous.mode,questions,index:0,answers:[],typed:'',isRetry:true};
    state.screen='quiz';state.error='';startQuestionClock();render();window.scrollTo(0,0);
  },
  again(){if(state.collection){state.collection=buildCollection(state.collection.kind);if(!activePool().length){actions['back-home']();return;}prepareCount();}state.screen='count';state.quiz=null;state.error='';render();window.scrollTo(0,0);},
  'select-all'(){state.selected=state.selected.size===state.sets.length?new Set():new Set(state.sets.map(s=>s.id));render();},
  'export-selected'(){exportSets(state.sets.filter(s=>state.selected.has(s.id)));},
  'export-draft'(){exportSets([state.draft]);},
  async new(){if(!await discardGuard())return;state.draft={title:t('newTitle'),words:[{english:'',meaning:'',explanation:''}]};state.dirty=true;state.error='';render();},
  async 'edit-set'(button){if(state.draft?.id===button.dataset.id)return;if(!await discardGuard())return;state.draft=structuredClone(state.sets.find(s=>s.id===button.dataset.id));state.dirty=false;state.error='';render();},
  'add-word'(){state.draft.words.push({english:'',meaning:'',explanation:''});markDirty();render();const index=state.draft.words.length-1;$(`#word-${index}-english`)?.focus({preventScroll:true});$(`#word-${index}-english`)?.scrollIntoView({block:'center',behavior:'auto'});},
  async 'remove-word'(button){if(!await confirmDialog('removeTitle',t('removeHelp'),'remove',true))return;state.draft.words.splice(Number(button.dataset.index),1);markDirty();render();},
  async save(){if(state.saving)return;try{const data=validateSet(state.draft);state.saving=true;state.error='';render();let saved;if(state.draft.id){saved=(await api(`/api/sets/${state.draft.id}`,{method:'PUT',body:JSON.stringify({...data,revision:state.draft.revision})})).set;state.sets=state.sets.map(s=>s.id===saved.id?saved:s);}else{const response=await api('/api/sets',{method:'POST',body:JSON.stringify(data)});saved=response.sets[0];state.sets.unshift(saved);synchronizeSetOrder(response);}state.draft=structuredClone(saved);state.dirty=false;toast(t('saved'));}catch(err){state.error=message(err);}finally{state.saving=false;render();}},
  async delete(){const draft=state.draft;if(!await confirmDialog('deleteTitle',t('deleteHelp',{title:draft.title}),'delete',true))return;state.saving=true;render();try{await deleteSavedSet(draft);}catch(err){state.error=message(err);}finally{state.saving=false;render();}},
  async logout(){if(!await discardGuard())return;try{await api('/api/logout',{method:'POST'});state.authenticated=false;state.adminData=null;state.adminStats=null;state.adminStatsId=null;state.draft=null;state.dirty=false;state.error='';render();}catch(err){toast(message(err));}},
  import:importDialog,
  export:exportDialog,
};
let cardGesture=null, suppressFlipUntil=0;
document.addEventListener('pointerdown',event=>{
  const target=event.target.closest('.flashcard');
  if(!target || state.screen!=='cards' || modal.open || event.isPrimary===false || event.button>0)return;
  cardGesture={target,id:event.pointerId,x:event.clientX,y:event.clientY};
});
document.addEventListener('pointermove',event=>{
  const gesture=cardGesture;if(!gesture || event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*1.2){
    event.preventDefault();
    try{gesture.target.setPointerCapture?.(event.pointerId);}catch{}
    gesture.target.style.transform=`translateX(${Math.max(-80,Math.min(80,dx*.4))}px) rotate(${Math.max(-3,Math.min(3,dx*.015))}deg)`;
  }
},{passive:false});
function finishCardGesture(event,cancelled=false){
  const gesture=cardGesture;if(!gesture || event.pointerId!==gesture.id)return;
  cardGesture=null;gesture.target.style.transform='';
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(cancelled || Math.abs(dx)>12 || Math.abs(dy)>12)suppressFlipUntil=Date.now()+400;
  if(cancelled || !gesture.target.isConnected || state.screen!=='cards' || modal.open)return;
  if(Math.abs(dx)>=48 && Math.abs(dx)>Math.abs(dy)*1.2)moveCard(dx<0?1:-1);
}
document.addEventListener('pointerup',event=>finishCardGesture(event));
document.addEventListener('pointercancel',event=>finishCardGesture(event,true));
document.addEventListener('keydown',event=>{
  if(state.screen!=='cards' || modal.open || event.altKey || event.metaKey || event.ctrlKey || event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='ArrowLeft' || event.key==='ArrowRight'){event.preventDefault();moveCard(event.key==='ArrowRight'?1:-1);}
  else if((event.key===' ' || event.key==='Enter') && (event.target===document.body || event.target.closest('.flashcard'))){event.preventDefault();if(!event.repeat)flipCard();}
});
document.addEventListener('mousedown',event=>{if(event.button===0 && event.target.closest('button,a'))event.preventDefault();},true);
document.addEventListener('click',async event=>{
  const pressed=event.target.closest('button,a');if(pressed && document.activeElement===pressed)pressed.blur();
  const nav=event.target.closest('[data-nav]');if(nav){event.preventDefault();await navigate(nav.dataset.nav);return;}
  const button=event.target.closest('[data-action]');if(button && !button.disabled){if(['new','import','export','export-draft','export-selected','manage-sets','save','delete','add-word','remove-word'].includes(button.dataset.action) && (state.route!=='edit' || !state.authenticated))return;if(button.dataset.action==='flip-card' && Date.now()<suppressFlipUntil)return;try{await actions[button.dataset.action]?.(button);}catch(err){toast(message(err));}}
  if(event.detail>0 && event.target.closest('button'))document.activeElement?.closest('button')?.blur();
});
document.addEventListener('input',event=>{const el=event.target;if(el.id==='admin-search'){state.adminSearch=el.value;refreshAdministration();}else if(el.id==='word-search'){state.wordSearch=el.value;state.listLimit=100;render();}else if(el.id==='search'){state.search=el.value;render();}else if(el.id==='custom-count')state.customValue=el.value;else if(el.id==='typed-answer')state.quiz.typed=el.value;else if(el.id==='set-title'){state.draft.title=el.value;markDirty();}else if(el.dataset.word!==undefined){state.draft.words[Number(el.dataset.word)][el.dataset.field]=el.value;markDirty();}});
// Blur before change handlers redraw the app; never focus a committed native picker again.
document.addEventListener('change',event=>{
  const select=event.target;if(select.tagName!=='SELECT')return;
  select.blur();
  requestAnimationFrame(()=>{if(document.activeElement===select)select.blur();});
},true);
document.addEventListener('keyup',event=>{if(event.key==='Escape' && event.target.tagName==='SELECT')event.target.blur();});
document.addEventListener('change',event=>{const el=event.target;if(el.id==='admin-status'){if(state.adminStatus===el.value)return;state.adminStatus=el.value;refreshAdministration();}else if(el.id==='ranking-metric'){if(state.rankingMetric===el.value)return;state.rankingMetric=el.value;refreshRankings();}else if(el.id==='weak-set'){if(state.weakSetId===el.value)return;state.weakSetId=el.value;state.listLimit=100;render();}else if(el.id==='favorite-set'){if(state.favoriteSet===el.value)return;state.favoriteSet=el.value;state.listLimit=100;render();}else if(el.dataset.weakSet!==undefined){if(el.checked)state.weakIds.add(el.dataset.weakSet);else state.weakIds.delete(el.dataset.weakSet);state.listLimit=100;render();}else if(el.id==='language'){languageChoice=el.value;storage.set('wordnest-language',languageChoice);setLanguage();render();}else if(el.dataset.select){if(el.checked)state.selected.add(el.dataset.select);else state.selected.delete(el.dataset.select);render();}});
document.addEventListener('submit',async event=>{
  if(event.target.id==='answer-form'){event.preventDefault();if(!state.quiz.typed.trim())return;submitAnswer(state.quiz.typed);}
  if(event.target.id==='admin-login-form'){event.preventDefault();await submitAdmin(event.target);}
});
document.addEventListener('visibilitychange',()=>{syncLearning();updateQuizClock();});
window.addEventListener('pageshow',()=>{syncLearning();updateQuizClock();});
window.addEventListener('pagehide',()=>{learning.setActive(false);ranking.flushOnExit();});
window.addEventListener('blur',()=>learning.setActive(false));
window.addEventListener('focus',syncLearning);
for(const type of ['pointerdown','click','keydown','input','scroll'])document.addEventListener(type,()=>{if(learning.active)learning.touch();},{capture:true,passive:true});
let rankingHeartbeatAt=0;
function learningHeartbeat(){learning.tick();learning.persist();if(Date.now()-rankingHeartbeatAt>=30000){rankingHeartbeatAt=Date.now();ranking.sync().then(()=>{if(state.route==='rankings')refreshRankings(false);}).catch(()=>{});}if(state.route==='stats' && statsRenderedDay!==localDay(Date.now()))render();setTimeout(learningHeartbeat,1000);}
setTimeout(learningHeartbeat,1000);
window.addEventListener('storage',event=>{if(event.key?.startsWith('wordnest-learning-v1:') && state.route==='stats')render();});
window.addEventListener('storage',event=>{if(event.key==='wordnest-progress' && state.route==='home' && state.screen==='home')render();});
window.addEventListener('hashchange',()=>navigate(routeFromHash(),true));
window.addEventListener('beforeunload',event=>{learning.setActive(false);if(state.dirty||state.saving){event.preventDefault();event.returnValue='';}});
load();

window.addEventListener('storage',event=>{if(event.key?.startsWith('wordnest-personal-v1:') && state.route==='home' && state.screen==='home')render();});

window.addEventListener('storage',event=>{
  if(event.key==='wordnest-reset-learning'){learning.syncReset();if(state.route==='stats')render();}
  else if(['wordnest-reset-question','wordnest-reset-favorite'].includes(event.key)){personal.syncResets();if(state.route==='home')render();}
});

window.addEventListener('online',()=>ranking.sync(true).then(()=>{if(state.route==='rankings')refreshRankings(false);}).catch(()=>{}));
window.addEventListener('storage',event=>{if(event.key==='wordnest-ranking-v1' || event.key==='wordnest-reset-learning'){refreshRankingSettings();ranking.sync(true).then(()=>{if(state.route==='rankings')refreshRankings(false);}).catch(()=>{});if(state.route==='rankings')render();}});
