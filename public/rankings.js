export const RANKING_KEY='wordnest-ranking-v1';
export const rankingMetrics={totalMs:'totalTime',averageMs:'averageTime',answered:'answeredQuestions',correct:'correctQuestions',accuracy:'accuracy',flips:'cardFlips',streak:'currentStreak',longest:'longestStreak'};
export function rankingName(value){const name=String(value || '').trim().normalize('NFC');if([...name].length<1 || [...name].length>20 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name))throw new Error('invalidRankingName');return name;}
export function rankingNameKey(value){return String(value).normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim().toLowerCase();}
export class RankingClient {
  constructor({storage,fetch=globalThis.fetch,snapshot,onChange=()=>{},crypto=globalThis.crypto}={}){
    this.storage=storage;this.fetch=fetch;this.snapshot=snapshot;this.onChange=onChange;this.crypto=crypto;this.queue=Promise.resolve();this.profile=null;this.lastSent='';this.error='';this.lastCheckedAt=0;
  }
  preferences(){try{const value=JSON.parse(this.storage?.getItem(RANKING_KEY) || 'null');return value && ['joined','declined'].includes(value.choice)?value:null;}catch{return null;}}
  save(value){try{if(!this.storage)throw new Error();this.storage.setItem(RANKING_KEY,JSON.stringify(value));}catch{throw new Error('rankingStorageError');}this.onChange();}
  token(){return [...this.crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  async join(value){const name=rankingName(value),previous=this.preferences();if(previous?.notice){if(!previous.notice.acknowledged)throw new Error('rankingNoticeRequired');if(rankingNameKey(name)===rankingNameKey(previous.notice.removedName))throw new Error('rankingNameUnchanged');}this.save({...previous,token:previous?.token || this.token(),name,choice:'joined',pending:this.token()});return this.sync(true);}
  async decline(value){
    const previous=this.preferences(),token=previous?.token || this.token();
    const name=value?.trim()?rankingName(value):previous?.name || `Learner ${this.token().slice(0,8)}`;
    this.save({...previous,token,name,choice:'declined',pending:this.token()});return this.sync(true);
  }
  async rename(value){
    const name=rankingName(value),previous=this.preferences(),token=previous?.token || this.token();
    this.save({...previous,token,name,choice:previous?.choice || 'declined',pending:this.token()});return this.sync(true);
  }
  async request(path,method='GET',data,token,keepalive=false){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await this.fetch(path,{method,credentials:'same-origin',signal:controller.signal,keepalive,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || 'serverError');return result;
    }catch(error){if(error?.message && ['rankingConflict','rankingDisabled','rankingUnauthorized','rankingRateLimit','invalidRankingData','invalidRankingName','rankingStorageError','serverError','rankingNoticeRequired','rankingNameUnchanged'].includes(error.message))throw error;throw new Error('networkError');}
    finally{clearTimeout(timeout);}
  }
  remember(profile){
    this.profile=profile;const prefs=this.preferences();if(!profile || !prefs)return;
    const notice=profile.notice || null;
    if(prefs.id!==profile.id || JSON.stringify(prefs.notice || null)!==JSON.stringify(notice))this.save({...prefs,id:profile.id,notice});
  }
  applyRemoval(profile){
    this.profile=profile;this.error='';const prefs=this.preferences();if(!prefs)return;
    const next={...prefs,id:profile.id,name:profile.name,choice:'declined',pending:null,notice:profile.notice};
    if(JSON.stringify(next)!==JSON.stringify(prefs))this.save(next);else this.onChange();
  }
  acknowledgeNotice(noticeId){
    const work=this.queue.catch(()=>{}).then(async()=>{
      const prefs=this.preferences();if(!prefs?.token)return;
      const result=await this.request('/api/ranking/notice','POST',{revision:this.profile?.revision || 0,noticeId},prefs.token);
      this.remember(result.profile);return result;
    });this.queue=work;return work;
  }
  sync(force=false){
    const work=this.queue.catch(()=>{}).then(()=>this.flush(force));
    this.queue=work;return work;
  }
  async flush(force){
    let prefs=this.preferences();if(!prefs)return;
    // Upgrade browsers that previously declined before a server identity was created.
    if(!prefs.token || !prefs.name){const token=prefs.token || this.token();this.save({...prefs,token,name:prefs.name || `Learner ${this.token().slice(0,8)}`,pending:this.token()});prefs=this.preferences();}
    const fingerprint=JSON.stringify(this.snapshot());
    if(!force && !prefs.pending && Date.now()-this.lastCheckedAt<30000 && fingerprint===this.lastSent)return;
    try{
      for(let attempt=0;attempt<4;attempt++){
        prefs=this.preferences();if(!prefs?.token)return;
        let profile=(await this.request('/api/ranking/profile','GET',undefined,prefs.token)).profile;this.lastCheckedAt=Date.now();
        try{
          let current=this.preferences();if(current?.token!==prefs.token)continue;
          if(profile?.notice){
            const notice=profile.notice,rejoining=current.pending && current.choice==='joined' && current.notice?.id===notice.id && notice.acknowledged && current.notice.acknowledged && rankingNameKey(current.name)!==rankingNameKey(notice.removedName);
            if(!rejoining && (current.choice==='joined' || !current.pending)){this.applyRemoval(profile);current=this.preferences();}
          }
          if(!profile && !current.pending){this.save({...current,pending:this.token()});current=this.preferences();}
          if(current.pending){
            const intent=current.pending,snapshot=this.snapshot();
            profile=(await this.request('/api/ranking/profile','POST',{revision:profile?.revision || 0,name:current.name,enabled:current.choice==='joined',epoch:snapshot.epoch,timezone:snapshot.timezone,noticeId:current.notice?.id},current.token)).profile;
            const latest=this.preferences();if(latest?.pending!==intent)continue;
            this.error='';this.save({...latest,id:profile.id,pending:null});
          }
          if(profile?.notice)this.applyRemoval(profile);
          this.remember(profile);current=this.preferences();
          if(!profile)return;
          if(!profile.enabled && current.choice==='joined'){this.save({...current,choice:'declined',pending:null});current=this.preferences();}
          if(profile.enabled && current.choice==='declined'){this.save({...current,pending:this.token()});continue;}
          let snapshot=this.snapshot();
          if(profile.epoch!==snapshot.epoch){profile=(await this.request('/api/ranking/stats','DELETE',{revision:profile.revision,epoch:snapshot.epoch},current.token)).profile;this.remember(profile);snapshot=this.snapshot();}
          const latest=this.preferences();if(latest?.pending || latest?.token!==current.token)continue;
          const sent=JSON.stringify(snapshot),result=await this.request('/api/ranking/stats','PUT',{...snapshot,revision:profile.revision},current.token);
          this.remember(result.profile);this.lastSent=sent;this.error='';this.onChange();return result;
        }catch(error){if(['rankingConflict','rankingDisabled'].includes(error.message))continue;throw error;}
      }
      throw new Error('rankingConflict');
    }catch(error){this.error=error.message;this.onChange();throw error;}
  }
  async list(metric){const prefs=this.preferences(),query=new URLSearchParams({metric});if(prefs?.choice==='joined' && prefs.id)query.set('self',prefs.id);return this.request('/api/rankings?'+query);}
  flushOnExit(){
    const prefs=this.preferences();if(!prefs?.token || prefs.pending || !this.profile)return;
    const snapshot=this.snapshot();if(snapshot.epoch!==this.profile.epoch)return;
    const body=JSON.stringify({...snapshot,revision:this.profile.revision});
    if(new TextEncoder().encode(body).length>60000)return;
    this.request('/api/ranking/stats','PUT',JSON.parse(body),prefs.token,true).catch(()=>{});
  }
}
