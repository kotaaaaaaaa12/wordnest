import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),publicRoot=resolve(root,'public');
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const paths=(await readdir(publicRoot)).filter(name=>name.endsWith('.js') || name==='styles.css');
for(const name of await readdir(resolve(publicRoot,'vendor')))if(name.endsWith('.js'))paths.push('vendor/'+name);
paths.sort();
const rewrite=(text,key)=>text.replace(/^(import[^\n]*?\bfrom\s*|export[^\n]*?\bfrom\s*)(["'])(\.{1,2}\/[^"'?\n]+\.js)(?:\?[^"'\n]*)?\2/gm,(_,prefix,quote,path)=>prefix+quote+path+(key?'?v='+key:'')+quote);
const files=await Promise.all(paths.map(async name=>{
 let text=await readFile(resolve(publicRoot,name),'utf8');
 if(name.endsWith('.js'))text=rewrite(text,'');
 if(name==='app.js')text=text.replace(/^const APP_VERSION = '[^']*';/m,`const APP_VERSION = '${version}';`);
 return [name,text];
}));
// Exclude generated queries from the hash so identical builds keep one key.
const hash=createHash('sha256');for(const [name,text] of files)hash.update(name+'\0').update(text).update('\0');
const key=version+'-'+hash.digest('hex').slice(0,16);
async function update(path,text){
 if(await readFile(path,'utf8')===text)return;
 const temporary=path+'.release-'+process.pid;await writeFile(temporary,text);await rename(temporary,path);
}
for(const [name,text] of files)if(name.endsWith('.js'))await update(resolve(publicRoot,name),rewrite(text,key));
const indexPath=resolve(publicRoot,'index.html');let html=await readFile(indexPath,'utf8');
for(const name of ['theme.js','styles.css','app.js']){
 const pattern=new RegExp('(["\\\'])/(?:releases/[^/]+/)?'+name.replace('.','\\.')+'(?:\\?[^"\\\']*)?\\1','g');
 html=html.replace(pattern,(_,quote)=>quote+'/'+name+'?v='+key+quote);
}
await update(indexPath,html);
// Migrate the old generated directory even when this ZIP is applied as an overlay.
await rm(resolve(publicRoot,'releases'),{recursive:true,force:true});
console.log(`Prepared query-versioned assets: ${key}`);
