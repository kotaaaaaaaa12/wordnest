import { categories, studyCategory, epochKey, validateStudyEntry } from './account-study.js';
const CURRENT='wordnest-account-v1';
const uid=()=>globalThis.crypto.randomUUID();
const timezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function keys(storage){return Array.from({length:storage?.length || 0},(_,index)=>storage.key(index)).filter(Boolean);}
const scoped=key=>studyCategory(key) || categories.some(category=>key===epochKey(category)) || key==='wordnest-ranking-v1';
export class AccountClient {
 constructor({storage,fetch=globalThis.fetch,beforeSwitch=()=>{},onSwitch=()=>{},onSync=()=>{}}={}){
  this.raw=storage;this.fetch=fetch;this.beforeSwitch=beforeSwitch;this.onSwitch=onSwitch;this.onSync=onSync;this.user=this.cachedUser();this.error='';this.expired=false;this.ready=false;this.signoutPending=false;try{this.signoutPending=this.raw?.getItem('wordnest-account-signout')==='pending';}catch{}this.queue=Promise.resolve();this.lastSync=null;this.sequence=0;
  const client=this;
  this.storage={
   get length(){return client.logicalKeys().length;},key:index=>client.logicalKeys()[index] ?? null,
   getItem:key=>client.raw?.getItem(client.dataKey(key)) ?? null,
   setItem:(key,value)=>client.write(key,String(value)),removeItem:key=>client.remove(key),
   recordAnswers:(questionKeys,correct)=>client.recordAnswers(questionKeys,correct)
  };
 }
 cachedUser(){try{const user=JSON.parse(this.raw?.getItem(CURRENT) || 'null');return /^[a-f0-9]{64}$/.test(user?.id) && typeof user.loginId==='string'?user:null;}catch{return null;}}
 dataPrefix(){return this.user?`wordnest-user:${this.user.id}:data:`:'';}
 dataKey(key){return this.user && scoped(key)?this.dataPrefix()+key:key;}
 logicalKeys(){const prefix=this.dataPrefix();return keys(this.raw).flatMap(key=>prefix?(key.startsWith(prefix)?[key.slice(prefix.length)]:[]):(!key.startsWith('wordnest-user:')?[key]:[]));}
 outboxPrefix(){return `wordnest-user:${this.user.id}:outbox:`;}
 pending(){if(!this.user)return [];return keys(this.raw).filter(key=>key.startsWith(this.outboxPrefix())).map(key=>{try{return {key,...JSON.parse(this.raw.getItem(key))};}catch{return null;}}).filter(Boolean).sort((a,b)=>a.time-b.time || a.order-b.order || a.key.localeCompare(b.key));}
 epoch(category){return this.storage.getItem(epochKey(category)) || '';}
 enqueue(operation){
  if(!this.user)return;
  const replace=operation.type==='reset'?this.pending().filter(entry=>entry.op.category===operation.category):operation.type==='set'?this.pending().filter(entry=>!entry.sent && entry.op.type==='set' && entry.op.key===operation.key && entry.op.epoch===operation.epoch):[];
  const op={id:uid(),...operation},entry={op,time:Date.now(),order:++this.sequence};
  this.raw.setItem(this.outboxPrefix()+op.id,JSON.stringify(entry));
  // Coalesce only unsent snapshots; sent IDs and payloads stay immutable.
  // A reset can discard its category's older outbox: epochs also reject any
  // discarded request that arrives after the reset.
  for(const previous of replace){const latest=JSON.parse(this.raw.getItem(previous.key) || 'null');if(latest && (operation.type==='reset' || !latest.sent))this.raw.removeItem(previous.key);}
 }
 write(key,value){
  if(!this.raw)throw new Error('accountStorageError');
  const previous=this.storage.getItem(key);if(previous===value)return;
  if(this.user){
   const reset=categories.find(category=>key===epochKey(category));
   if(reset)this.enqueue({type:'reset',category:reset,epoch:previous || '',nextEpoch:value});
   else{const category=studyCategory(key);if(category && category!=='question')this.enqueue({type:'set',category,epoch:this.epoch(category),key,value:JSON.parse(value)});}
  }
  this.raw.setItem(this.dataKey(key),value);
 }
 remove(key){
  if(!this.raw)throw new Error('accountStorageError');
  if(this.user && key==='wordnest-progress')this.write(epochKey('progress'),uid());
  this.raw.removeItem(this.dataKey(key));
 }
 recordAnswers(questionKeys,correct){if(this.user && questionKeys.length)this.enqueue({type:'answer',category:'question',epoch:this.epoch('question'),keys:questionKeys,correct});}
 guestEntries(){
  const entries={};
  for(const key of keys(this.raw)){
   const raw=this.raw.getItem(key);if(raw===null)continue;
   if(categories.some(category=>key===epochKey(category))){if(raw.length<=120)entries[key]=raw;continue;}
   if(!studyCategory(key))continue;
   try{validateStudyEntry(key,JSON.parse(raw));entries[key]=raw;}catch{}
  }
  return entries;
 }
 guestProfile(){try{const profile=JSON.parse(this.raw?.getItem('wordnest-ranking-v1') || 'null');return /^[a-f0-9]{64}$/.test(profile?.token)?profile:null;}catch{return null;}}
 hasGuestRecords(){return Boolean(this.guestProfile()) || Object.keys(this.guestEntries()).some(key=>!key.startsWith('wordnest-reset-'));}
 retireGuest(entries,token){
  // Only remove the snapshot acknowledged by the server. New guest activity
  // written by another tab must remain available for a later transfer.
  for(const [key,value] of Object.entries(entries))if(this.raw?.getItem(key)===value)this.raw.removeItem(key);
  if(token && this.guestProfile()?.token===token)this.raw.removeItem('wordnest-ranking-v1');
 }
 async request(path,data,keepalive=false){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await this.fetch('/api/account/'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,keepalive,headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
   const result=await response.json();if(!response.ok)throw new Error(result.error || 'serverError');return result;
  }catch(error){if(error.message?.startsWith('account') || ['tooLarge','jsonRequired','invalidImport'].includes(error.message) || error.message==='invalidRankingName' || error.message==='serverError')throw error;throw new Error('networkError');}
  finally{clearTimeout(timeout);}
 }
 setUser(user){
  const previous=this.user?.id;if(user){this.raw?.removeItem('wordnest-account-signout');this.signoutPending=false;}if(previous!==user?.id)this.beforeSwitch();this.raw?.setItem(CURRENT,JSON.stringify(user));this.user=user;this.expired=false;this.error='';
  if(previous!==user?.id)this.onSwitch();
 }
 async initialize(){
  try{
   if(this.signoutPending){try{await this.request('logout',{});}catch(error){if(error.message!=='accountUnauthorized')throw error;}this.raw?.removeItem('wordnest-account-signout');this.signoutPending=false;return;}
   const result=await this.request('session');
   if(Object.hasOwn(result,'user')){
    if(result.user){if(this.user?.id!==result.user.id)this.setUser(result.user);await this.sync();}
    else if(this.user){this.expired=true;this.error='accountSessionExpired';}
   }
  }catch(error){this.error=error.message;}
  finally{this.ready=true;this.onSync();}
 }
 ensureStorage(){try{if(!this.raw)throw new Error();const key='wordnest-storage-check:'+uid();this.raw.setItem(key,'1');this.raw.removeItem(key);}catch{throw new Error('accountStorageError');}}
 async register({loginId,password,name,enabled}){
  this.ensureStorage();
  const entries=this.guestEntries(),legacy=this.guestProfile();
  const result=await this.request('register',{loginId,password,name,enabled,entries,legacyToken:legacy?.token,timezone:timezone()});
  this.setUser(result.user);this.apply(result.study,[],0);
  this.retireGuest(entries,legacy?.token);this.lastSync=Date.now();this.onSync();return result;
 }
 async login(loginId,password){this.ensureStorage();const result=await this.request('login',{loginId,password});this.setUser(result.user);await this.sync();return result;}
 async importGuest(){
  await this.sync();const entries=this.guestEntries(),legacy=this.guestProfile();
  if(!this.hasGuestRecords())return;
  this.enqueue({type:'import',category:'learning',epoch:this.epoch('learning'),epochs:Object.fromEntries(categories.map(category=>[category,this.epoch(category)])),entries,legacyToken:legacy?.token});
  await this.sync();
 }
 async logout(){
  await this.sync().catch(()=>{});
  try{await this.request('logout',{});}catch(error){if(error.message!=='accountUnauthorized'){this.raw?.setItem('wordnest-account-signout','pending');this.signoutPending=true;}}
  this.setUser(null);this.lastSync=null;this.error='';this.onSync();
 }
 async changePassword(currentPassword,password){return this.request('password',{currentPassword,password});}
 apply(study,acknowledged,revision){
  if(!study?.entries || !study.epochs)throw new Error('accountInvalidData');
  const prefix=this.outboxPrefix();for(const id of acknowledged){
   const key=prefix+id;let entry;try{entry=JSON.parse(this.raw.getItem(key) || 'null');}catch{}
   if(entry?.op.type==='import')this.retireGuest(entry.op.entries,entry.op.legacyToken);
   this.raw.removeItem(key);
  }
  const revisionKey=`wordnest-user:${this.user.id}:revision`,previousRevision=Number(this.raw.getItem(revisionKey) || -1);
  if(Number.isSafeInteger(revision) && revision<previousRevision)return;
  if(Number.isSafeInteger(revision))this.raw.setItem(revisionKey,String(revision));
  const pending=this.pending(),protectedCategories=new Set(pending.filter(entry=>entry.op.type==='reset').map(entry=>entry.op.category)),protectedKeys=new Set(pending.flatMap(entry=>entry.op.type==='answer'?entry.op.keys:entry.op.key?[entry.op.key]:[]));
  for(const key of this.logicalKeys())if(studyCategory(key) && !protectedCategories.has(studyCategory(key)) && !protectedKeys.has(key) && !Object.hasOwn(study.entries,key))this.raw.removeItem(this.dataKey(key));
  for(const [key,value] of Object.entries(study.entries))if(studyCategory(key) && !protectedCategories.has(studyCategory(key)) && !protectedKeys.has(key))this.raw.setItem(this.dataKey(key),JSON.stringify(value));
  for(const category of categories)if(!protectedCategories.has(category))this.raw.setItem(this.dataKey(epochKey(category)),study.epochs[category]);
 }
 sync(){
  const owner=this.user?.id;
  const work=this.queue.catch(()=>{}).then(()=>{
   if(this.user?.id!==owner)return;
   const run=()=>this.user?.id===owner?this.flush():undefined;
   return owner && globalThis.navigator?.locks?.request?globalThis.navigator.locks.request('wordnest-account-sync:'+owner,run):run();
  });this.queue=work;return work;
 }
 markSent(pending){for(const entry of pending){const current=JSON.parse(this.raw.getItem(entry.key) || 'null');if(current)this.raw.setItem(entry.key,JSON.stringify({...current,sent:true}));}}
 async flush(){
  if(!this.user || this.expired)return;
  const id=this.user.id;
  try{
   for(let batch=0;batch<100;batch++){
    const pending=this.pending().slice(0,50);this.markSent(pending);const result=await this.request('sync',{accountId:id,operations:pending.map(entry=>entry.op),timezone:timezone()});
    if(this.user?.id!==id)return;
    if(result.user?.id!==id)throw new Error('accountSessionChanged');
    this.apply(result.study,result.acknowledged,result.revision);this.lastSync=Date.now();this.error='';
    if(!this.pending().length){this.onSync();return result;}
   }
   throw new Error('accountSyncPending');
  }catch(error){this.error=error.message;if(error.message==='accountUnauthorized'){this.expired=true;this.error='accountSessionExpired';}this.onSync();throw error;}
 }
 flushOnExit(){
  if(!this.user || this.expired)return;
  const pending=this.pending().slice(0,50),data={accountId:this.user.id,operations:pending.map(entry=>entry.op),timezone:timezone()};
  if(!pending.length || new TextEncoder().encode(JSON.stringify(data)).length>60000)return;
  // Keep the outbox until an ordinary sync confirms receipt; IDs prevent duplicates.
  this.markSent(pending);this.request('sync',data,true).catch(()=>{});
 }
}
