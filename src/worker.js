import { rankingApi, rankingAdminApi, rankingSchema } from './rankings.js';
import { validateSet } from '../public/core.js';
const initialized = new WeakMap();
const encoder = new TextEncoder();
const MAX_BODY = 2 * 1024 * 1024;
const SESSION_SECONDS = 30 * 86400;
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
async function initialize(db) {
  if (!initialized.has(db)) initialized.set(db, (async () => {
    await db.batch([
      ...rankingSchema.map(sql=>db.prepare(sql)),
      db.prepare('CREATE TABLE IF NOT EXISTS sets (id TEXT PRIMARY KEY, title TEXT NOT NULL, words TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1)))'),
      db.prepare('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY)'),
      db.prepare('CREATE TABLE IF NOT EXISTS set_order (id INTEGER PRIMARY KEY CHECK(id=1), ids TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)'),
      db.prepare('CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)')
    ]);
    const columns=await db.prepare('PRAGMA table_info(sets)').all();
    if(!columns.results.some(column=>column.name==='published')){
      try{await db.prepare('ALTER TABLE sets ADD COLUMN published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1))').run();}
      catch(error){
        const current=await db.prepare('PRAGMA table_info(sets)').all();
        if(!current.results.some(column=>column.name==='published'))throw error;
      }
    }
    const migrated = await db.prepare("SELECT key FROM metadata WHERE key='remove-default-example-v2'").first();
    if (!migrated) {
      const example = await db.prepare("SELECT * FROM sets WHERE id='starter-essentials' AND revision=1").first();
      const statements = [];
      if (example && example.title === 'English Essentials · 1–20') {
        const hash = [...await digest(example.words)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash === 'c1bb017001b0c9de9a79aa61bb84c8f4d4d9a3efee953bde681bfcb1fe6e0b9f') statements.push(db.prepare('DELETE FROM sets WHERE id=? AND revision=1 AND title=? AND words=?').bind(example.id, example.title, example.words));
      }
      statements.push(db.prepare("INSERT OR IGNORE INTO metadata (key) VALUES ('remove-default-example-v2')"));
      await db.batch(statements);
    }
    await db.prepare('INSERT OR IGNORE INTO set_order (id,ids,revision) SELECT 1,json_group_array(id),0 FROM (SELECT id FROM sets ORDER BY updated_at DESC,id)').run();
  })().catch(error => { initialized.delete(db); throw error; }));
  await initialized.get(db);
}
async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function signingKey(password) { return crypto.subtle.importKey('raw', await digest(`wordnest-session:${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
function b64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function unb64(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function session(password) {
  const data = `${Math.floor(Date.now() / 1000) + SESSION_SECONDS}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(password), encoder.encode(data));
  return `${data}.${b64(new Uint8Array(signature))}`;
}
async function authenticated(request, env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) return false;
  const token = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith('wordnest_session='))?.slice(17);
  if (!token) return false;
  try {
    const [expires, nonce, signature, extra] = token.split('.');
    if (extra || !nonce || !signature || !/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000 || Number(expires) > Date.now() / 1000 + SESSION_SECONDS + 60) return false;
    return crypto.subtle.verify('HMAC', await signingKey(env.ADMIN_PASSWORD), unb64(signature), encoder.encode(`${expires}.${nonce}`));
  } catch { return false; }
}
function cookie(request, token = '', age = SESSION_SECONDS) {
  return `wordnest_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw Object.assign(new Error('jsonRequired'), { status: 415 });
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw Object.assign(new Error('tooLarge'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalidImport');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw Object.assign(new Error('tooLarge'), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('invalidImport'); }
}
async function api(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return reply({ error: 'methodNotAllowed' }, 405);
  if (method !== 'GET' && ((request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return reply({ error: 'forbidden' }, 403);
  if (!env.DB) return reply({ error: 'databaseMissing' }, 503);
  await initialize(env.DB);
  const configured = Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 12);
  if (path === '/api/session' && method === 'GET') return reply({ authenticated: await authenticated(request, env), configured });
  if (path === '/api/login' && method === 'POST') {
    if (!configured) return reply({ error: 'passwordSetup' }, 503);
    const data = await body(request);
    const now = Math.floor(Date.now() / 1000), window = Math.floor(now / 900);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const key = b64(await digest(`${ip}:${window}`));
    await env.DB.prepare('DELETE FROM login_limits WHERE expires < ?').bind(now).run();
    const limit = await env.DB.prepare('INSERT INTO login_limits (key,attempts,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key, now + 900).first();
    if (limit.attempts > 10) return reply({ error: 'tooManyAttempts' }, 429, { 'Retry-After': '900' });
    const supplied = typeof data.password === 'string' ? data.password : '';
    const a = await digest(supplied), b = await digest(env.ADMIN_PASSWORD);
    let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference !== 0) return reply({ error: 'wrongPassword' }, 401);
    await env.DB.prepare('DELETE FROM login_limits WHERE key=?').bind(key).run();
    return reply({ ok: true }, 200, { 'Set-Cookie': cookie(request, await session(env.ADMIN_PASSWORD)) });
  }
  if (path === '/api/logout' && method === 'POST') return reply({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  if (path === '/api/sets' && method === 'GET') {
    const admin=await authenticated(request,env);
    const [rows, ordering] = await env.DB.batch([env.DB.prepare(admin?'SELECT * FROM sets ORDER BY updated_at DESC,id':'SELECT * FROM sets WHERE published=1 ORDER BY updated_at DESC,id'), env.DB.prepare('SELECT ids,revision FROM set_order WHERE id=1')]);
    const order=ordering.results[0], positions=new Map(JSON.parse(order.ids).map((id,index)=>[id,index]));
    rows.results.sort((a,b)=>(positions.get(a.id)??Number.MAX_SAFE_INTEGER)-(positions.get(b.id)??Number.MAX_SAFE_INTEGER));
    return reply({ sets: rows.results.map(s => ({ id: s.id, title: s.title, words: JSON.parse(s.words), published: s.published===1, revision: s.revision, updatedAt: s.updated_at })), orderRevision: order.revision });
  }
  if(path==='/api/rankings' || path.startsWith('/api/ranking/'))return rankingApi(request,env.DB,body);
  if (!await authenticated(request, env)) return reply({ error: 'unauthorized' }, 401);
  if(path.startsWith('/api/admin/'))return rankingAdminApi(request,env.DB,body);
  if (path === '/api/sets/order' && method === 'PUT') {
    const data=await body(request);
    if(!Array.isArray(data.ids) || data.ids.length>200 || data.ids.some(id=>typeof id!=='string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) || new Set(data.ids).size!==data.ids.length || !Number.isInteger(data.revision) || data.revision<0) return reply({error:'invalidSetOrder'},400);
    const ids=JSON.stringify(data.ids);
    const saved=await env.DB.prepare('UPDATE set_order SET ids=?,revision=revision+1 WHERE id=1 AND revision=? AND (SELECT COUNT(*) FROM sets)=? AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item LEFT JOIN sets ON sets.id=item.value WHERE sets.id IS NULL) RETURNING revision').bind(ids,data.revision,data.ids.length,ids).first();
    return saved ? reply({ok:true,orderRevision:saved.revision}) : reply({error:'orderConflict'},409);
  }
  if (path === '/api/sets' && method === 'POST') {
    const data = await body(request);
    const incoming = Array.isArray(data.sets) ? data.sets : [data];
    if (!incoming.length || incoming.length > 100) throw new Error('invalidImport');
    const sets = incoming.map(validateSet);
    const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM sets').first();
    if (total + sets.length > 200) return reply({ error: 'setLimit' }, 400);
    const now = new Date().toISOString();
    const created = sets.map(s => ({ ...s, published:s.published!==false, id: crypto.randomUUID(), revision: 1, updatedAt: now }));
    const results=await env.DB.batch([
      ...created.map(s => env.DB.prepare('INSERT INTO sets (id,title,words,updated_at,published) VALUES (?,?,?,?,?)').bind(s.id, s.title, JSON.stringify(s.words), now, s.published?1:0)),
      env.DB.prepare('UPDATE set_order SET ids=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(?) UNION ALL SELECT value FROM json_each(set_order.ids))),revision=revision+1 WHERE id=1 RETURNING ids,revision').bind(JSON.stringify(created.map(s=>s.id)))
    ]);
    return reply({ sets: created, orderRevision:results.at(-1).results[0].revision, orderedIds:JSON.parse(results.at(-1).results[0].ids) }, 201);
  }
  const match = path.match(/^\/api\/sets\/([a-zA-Z0-9-]{1,80})$/);
  if (match && method === 'PUT') {
    const data = await body(request), set = validateSet(data);
    if (!Number.isInteger(data.revision) || data.revision < 1) throw new Error('invalidImport');
    const result = await env.DB.prepare('UPDATE sets SET title=?,words=?,published=COALESCE(?,published),revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING *').bind(set.title, JSON.stringify(set.words), data.published===undefined?null:data.published?1:0, new Date().toISOString(), match[1], data.revision).first();
    if (!result) return reply({ error: 'conflict' }, 409);
    return reply({ set: { id: result.id, title: result.title, words: JSON.parse(result.words), published: result.published===1, revision: result.revision, updatedAt: result.updated_at } });
  }
  if (match && method === 'DELETE') {
    const revision = Number(url.searchParams.get('revision'));
    if (!Number.isInteger(revision) || revision < 1) throw new Error('invalidImport');
    const results=await env.DB.batch([
      env.DB.prepare('UPDATE set_order SET ids=(SELECT json_group_array(value) FROM json_each(set_order.ids) WHERE value<>?),revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM sets WHERE id=? AND revision=?) RETURNING ids,revision').bind(match[1],match[1],revision),
      env.DB.prepare('DELETE FROM sets WHERE id=? AND revision=?').bind(match[1],revision)
    ]);
    return results[1].meta.changes ? reply({ ok:true, orderRevision:results[0].results[0].revision, orderedIds:JSON.parse(results[0].results[0].ids) }) : reply({ error: 'conflict' },409);
  }
  return reply({ error: 'notFound' }, 404);
}
export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env); }
    catch (error) {
      const known = ['invalidTitle', 'invalidWords', 'invalidIpa', 'invalidIpaStyle', 'invalidVisibility', 'duplicateWord', 'invalidImport', 'jsonRequired', 'tooLarge'];
      if((error.status && error.message.startsWith('ranking')) || ['invalidRankingData','invalidRankingName','invalidRankingMessage'].includes(error.message))return reply({error:error.message},error.status || 400);
      if (known.includes(error.message)) return reply({ error: error.message }, error.status || 400);
      console.error('API request failed', error.message);
      return reply({ error: 'serverError' }, 500);
    }
  }
};
