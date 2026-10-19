export const RANKING_KEY='wordnest-ranking-v1';
export const rankingMetrics={totalMs:'totalTime',averageMs:'averageTime',answered:'answeredQuestions',correct:'correctQuestions',accuracy:'accuracy',flips:'cardFlips',streak:'currentStreak',longest:'longestStreak'};
export function rankingName(value){const name=String(value || '').trim().normalize('NFC');if([...name].length<1 || [...name].length>20 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name))throw new Error('invalidRankingName');return name;}
export class RankingClient {
  constructor({storage,fetch=globalThis.fetch,snapshot,onChange=()=>{},crypto=globalThis.crypto}={}){
    this.storage=storage;this.fetch=fetch;this.snapshot=snapshot;this.onChange=onChange;this.crypto=crypto;this.queue=Promise.resolve();this.profile=null;this.lastSent='';this.error='';
  }
  preferences(){try{const value=JSON.parse(this.storage?.getItem(RANKING_KEY) || 'null');return value && ['joined','declined'].includes(value.choice)?value:null;}catch{return null;}}
  save(value){try{if(!this.storage)throw new Error();this.storage.setItem(RANKING_KEY,JSON.stringify(value));}catch{throw new Error('rankingStorageError');}this.onChange();}
  token(){return [...this.crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  async join(value){const name=rankingName(value),previous=this.preferences();this.save({...previous,token:previous?.token || this.token(),name,choice:'joined',pending:this.token()});return this.sync(true);}
  async decline(){const previous=this.preferences();this.save({...previous,choice:'declined',pending:previous?.token?this.token():null});return this.sync(true);}
  async request(path,method='GET',data,token,keepalive=false){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await this.fetch(path,{method,credentials:'same-origin',signal:controller.signal,keepalive,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || 'serverError');return result;
    }catch(error){if(error?.message && ['rankingConflict','rankingDisabled','rankingUnauthorized','rankingRateLimit','invalidRankingData','invalidRankingName','rankingStorageError','serverError'].includes(error.message))throw error;throw new Error('networkError');}
    finally{clearTimeout(timeout);}
  }
  remember(profile){this.profile=profile;const prefs=this.preferences();if(profile && prefs && prefs.id!==profile.id)this.save({...prefs,id:profile.id});}
  sync(force=false){
    const work=this.queue.catch(()=>{}).then(()=>this.flush(force));
    this.queue=work;return work;
  }
  async flush(force){
    let prefs=this.preferences();if(!prefs?.token || (prefs.choice==='declined' && !prefs.pending))return;
    const first=this.snapshot(),fingerprint=JSON.stringify(first);
    if(!force && !prefs.pending && fingerprint===this.lastSent)return;
    try{
      for(let attempt=0;attempt<4;attempt++){
        prefs=this.preferences();if(!prefs?.token || (prefs.choice==='declined' && !prefs.pending))return;
        let profile=(await this.request('/api/ranking/profile','GET',undefined,prefs.token)).profile;
        try{
          let current=this.preferences();if(current?.token!==prefs.token)continue;
          if(current.pending){
            const intent=current.pending,snapshot=this.snapshot();
            profile=(await this.request('/api/ranking/profile','POST',{revision:profile?.revision || 0,name:current.name,enabled:current.choice==='joined',epoch:snapshot.epoch,timezone:snapshot.timezone},current.token)).profile;
            const latest=this.preferences();if(latest?.pending!==intent)continue;
            this.error='';this.save({...latest,id:profile.id,pending:null});
          }
          this.remember(profile);current=this.preferences();
          if(current.choice!=='joined')return;
          if(!profile?.enabled){this.save({...current,choice:'declined',pending:null});return;}
          let snapshot=this.snapshot();
          if(profile.epoch!==snapshot.epoch){profile=(await this.request('/api/ranking/stats','DELETE',{revision:profile.revision,epoch:snapshot.epoch},current.token)).profile;this.remember(profile);snapshot=this.snapshot();}
          const latest=this.preferences();if(latest?.choice!=='joined' || latest.pending || latest.token!==current.token)continue;
          const sent=JSON.stringify(snapshot),result=await this.request('/api/ranking/stats','PUT',{...snapshot,revision:profile.revision},current.token);
          this.remember(result.profile);this.lastSent=sent;this.error='';this.onChange();return result;
        }catch(error){if(['rankingConflict','rankingDisabled'].includes(error.message))continue;throw error;}
      }
      throw new Error('rankingConflict');
    }catch(error){this.error=error.message;this.onChange();throw error;}
  }
  async list(metric){const prefs=this.preferences(),query=new URLSearchParams({metric});if(prefs?.choice==='joined' && prefs.id)query.set('self',prefs.id);return this.request('/api/rankings?'+query);}
  flushOnExit(){
    const prefs=this.preferences();if(!prefs?.token || prefs.choice!=='joined' || prefs.pending || !this.profile?.enabled)return;
    const snapshot=this.snapshot();if(snapshot.epoch!==this.profile.epoch)return;
    const body=JSON.stringify({...snapshot,revision:this.profile.revision});
    if(new TextEncoder().encode(body).length>60000)return;
    this.request('/api/ranking/stats','PUT',JSON.parse(body),prefs.token,true).catch(()=>{});
  }
}
