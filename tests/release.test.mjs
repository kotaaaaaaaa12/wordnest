import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile,mkdtemp,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

test('entrypoints and every transitive browser import share a version query without release directories',async()=>{
 const html=await readFile('public/index.html','utf8'),key=html.match(/src="\/app\.js\?v=([^" ]+)"/)?.[1];assert.ok(key);
 assert.ok(html.includes('href="/styles.css?v='+key+'"'));assert.ok(html.includes('src="/theme.js?v='+key+'"'));assert.ok(!html.includes('/releases/'));
 const pending=['app.js','theme.js'],seen=new Set(),base=resolve('public');
 while(pending.length){
  const name=pending.pop();if(seen.has(name))continue;seen.add(name);const code=await readFile(resolve(base,name),'utf8');
  for(const match of code.matchAll(/^import .*?from ['"]([^'"]+)['"];\s*$/gm)){
   const url=new URL(match[1],'https://wordnest.example/'+name);assert.equal(url.searchParams.get('v'),key);pending.push(url.pathname.slice(1));
  }
 }
 assert.ok(seen.has('accounts.js'));assert.ok(seen.has('account-study.js'));assert.ok(seen.has('vendor/fflate.js'));
 await assert.rejects(access('public/releases'));
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.build.command,'node scripts/release.mjs');
});

test('query generation is stable, detects edits without version bumps, and removes the previous generated tree',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wordnest-query-test-'));
 try{
  await mkdir(join(root,'scripts'));await mkdir(join(root,'public/vendor'),{recursive:true});await mkdir(join(root,'public/releases/old'),{recursive:true});
  await writeFile(join(root,'scripts/release.mjs'),await readFile('scripts/release.mjs'));await writeFile(join(root,'package.json'),JSON.stringify({version:'1.2.3'}));
  await writeFile(join(root,'public/app.js'),"const APP_VERSION = '0.0.0';\nimport {word} from './accounts.js';\n");await writeFile(join(root,'public/accounts.js'),"export const word='hello';\n");await writeFile(join(root,'public/theme.js'),'// theme\n');await writeFile(join(root,'public/styles.css'),'body{}');
  await writeFile(join(root,'public/index.html'),'<script src="/releases/old/theme.js"></script><link href="/releases/old/styles.css"><script src="/releases/old/app.js"></script>');
  const build=()=>execFileSync(process.execPath,[join(root,'scripts/release.mjs')]);build();const before=await readFile(join(root,'public/index.html'),'utf8');build();assert.equal(await readFile(join(root,'public/index.html'),'utf8'),before);
  assert.ok((await readFile(join(root,'public/app.js'),'utf8')).includes("const APP_VERSION = '1.2.3';"));await assert.rejects(access(join(root,'public/releases')));
  await writeFile(join(root,'public/accounts.js'),"export const word='changed';\n");build();assert.notEqual(await readFile(join(root,'public/index.html'),'utf8'),before);
  assert.deepEqual((await readdir(join(root,'public'))).sort(),['accounts.js','app.js','index.html','styles.css','theme.js','vendor']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('HTML is not cached and query-versioned application paths revalidate without conflicting directives',async()=>{
 const text=await readFile('public/_headers','utf8'),rules=[];let current;
 for(const line of text.split('\n')){if(line.startsWith('/')){current={path:line.trim(),cache:[]};rules.push(current);}else if(line.includes('Cache-Control:'))current.cache.push(line.split('Cache-Control:')[1].trim());}
 const cache=path=>rules.filter(rule=>new RegExp('^'+rule.path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('\\*','.*')+'$').test(new URL(path,'https://wordnest.example').pathname)).flatMap(rule=>rule.cache);
 assert.deepEqual(cache('/'),['no-store']);assert.deepEqual(cache('/index.html'),['no-store']);
 for(const name of (await readdir('public')).filter(name=>name.endsWith('.js') || name==='styles.css'))assert.deepEqual(cache('/'+name+'?v=example'),['no-cache, max-age=0, must-revalidate']);
});
