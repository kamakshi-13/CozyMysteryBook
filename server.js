'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
try { const raw=fs.readFileSync(path.join(__dirname,'.env'),'utf8'); for(const line of raw.split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');} } catch {}
const { db, hashPassword, verifyPassword } = require('./lib/database');
const engine = require('./puzzle-engine');
const { callOllama, getOllamaStatus } = require('./lib/ollama');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ADMIN_PATH = (process.env.ADMIN_PATH || '/admin/lantern-room').replace(/\/$/, '');
const VALID_KEYS = ['wordsearch', 'sudoku', 'number', 'murdoku', 'hidden'];
const ROUTES = [];
const SHOP_ITEMS = [
  { id: 'coffee', name: 'Ceramic coffee cup', icon: '☕', cost: 10, slot: 'desk' },
  { id: 'fern', name: 'Little fern', icon: '🪴', cost: 18, slot: 'shelf' },
  { id: 'lamp', name: 'Amber reading lamp', icon: '🪔', cost: 24, slot: 'table' },
  { id: 'cat', name: 'Sleepy reading cat', icon: '🐈', cost: 35, slot: 'rug' },
  { id: 'books', name: 'Stack of old books', icon: '📚', cost: 16, slot: 'shelf' },
  { id: 'flowers', name: 'Fresh garden flowers', icon: '💐', cost: 20, slot: 'window' },
  { id: 'candle', name: 'Vanilla candle', icon: '🕯️', cost: 14, slot: 'desk' },
  { id: 'clock', name: 'Antique wall clock', icon: '🕰️', cost: 42, slot: 'wall' },
  { id: 'teddy', name: 'Tiny teddy bear', icon: '🧸', cost: 28, slot: 'chair' },
  { id: 'painting', name: 'Meadow painting', icon: '🖼️', cost: 32, slot: 'wall' }
];

function route(method, pattern, handler) { ROUTES.push({ method, pattern, handler }); }
function json(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function text(res, status, value, contentType = 'text/plain; charset=utf-8') {
  const data = Buffer.from(value);
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0,index).trim()] = decodeURIComponent(part.slice(index+1).trim());
  }
  return result;
}
function createSession(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(sid,user_id,expires_at) VALUES(?,?,?)').run(sid, userId, Date.now()+7*86400000);
  res.setHeader('Set-Cookie', `cozy.sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
}
function clearSession(req, res) {
  const sid = parseCookies(req.headers.cookie)['cozy.sid'];
  if (sid) db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
  res.setHeader('Set-Cookie', 'cozy.sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function currentUser(req) {
  const sid = parseCookies(req.headers.cookie)['cozy.sid'];
  if (!sid) return null;
  const session = db.prepare('SELECT user_id,expires_at FROM sessions WHERE sid=?').get(sid);
  if (!session) return null;
  if (session.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); return null; }
  return db.prepare('SELECT id,username,role,coins,room_layout FROM users WHERE id=?').get(session.user_id) || null;
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('Request body is too large.');
  }
  if (!raw) return {};
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) return JSON.parse(raw);
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return {};
}
function dateInZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function addDays(dateString, amount) {
  const d = new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+amount); return d.toISOString().slice(0,10);
}
function nowInZone() { return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); }
function getSetting(key) { return db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value || null; }
function setSetting(key, value) { db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value)); }
function getBooklet(id) {
  const row = db.prepare('SELECT * FROM booklets WHERE id=?').get(Number(id));
  return row ? { ...row, content: JSON.parse(row.content_json), validation: JSON.parse(row.validation_json) } : null;
}
function getBookletByDate(date) {
  const row = db.prepare('SELECT * FROM booklets WHERE publish_date=?').get(date);
  return row ? { ...row, content: JSON.parse(row.content_json), validation: JSON.parse(row.validation_json) } : null;
}
function safeBooklet(record) {
  const b = record.content, p = b.puzzles;
  return {
    id: record.id, date: b.date, title: b.title,
    opening: b.creative?.opening || 'A quiet house. A curious clue. A mystery waiting to be solved.',
    status: record.status, youtubeUrl: record.youtube_url || '', creative: b.creative || {},
    puzzles: {
      wordsearch: { size:p.wordsearch.size, grid:p.wordsearch.grid, words:p.wordsearch.words, instructions:b.creative?.instructions?.wordsearch || 'Find every hidden word. Words may run in any direction.' },
      sudoku: { size:p.sudoku.size, boxRows:p.sudoku.boxRows, boxCols:p.sudoku.boxCols, givens:p.sudoku.givens, keyIndex:p.sudoku.keyIndex, roomCodes:engine.ROOM_CODES, instructions:b.creative?.instructions?.sudoku || 'Fill 1–6 in every row, column and 2×3 box. The golden square is the room code.' },
      number: { sequence:p.number.sequence, hint:b.creative?.hints?.number || p.number.hint, instructions:b.creative?.instructions?.number || 'Find the next number in the sequence. It reveals the time.' },
      murdoku: { size:p.murdoku.size, people:p.murdoku.people, victim:p.murdoku.victim, rooms:p.murdoku.rooms, roomNames:p.murdoku.roomNames, blocked:p.murdoku.blocked, furniture:p.murdoku.furniture, clues:p.murdoku.clues, instructions:b.creative?.instructions?.murdoku || 'Place one person in each row and column. Use notes to track possibilities.' },
      hidden: { targets:p.hidden.targets.map(t=>({id:t.id,symbol:t.symbol,label:t.label,hint:t.hint,x:t.x,y:t.y})), clutter:p.hidden.clutter, scene:p.hidden.scene, weaponSpot:{x:p.hidden.weaponObject.x,y:p.hidden.weaponObject.y,symbol:p.hidden.weaponObject.symbol}, hints:b.creative?.hints?.hidden || p.hidden.targets.map(t=>t.hint), instructions:b.creative?.instructions?.hidden || 'Find the tiny objects hidden in the garden. Three found objects reveal the final evidence.' }
    }
  };
}
function userSummary(id) {
  const user = db.prepare('SELECT id,username,role,coins,room_layout FROM users WHERE id=?').get(id);
  if (!user) return null;
  const inventory = db.prepare('SELECT item_id,quantity FROM inventory WHERE user_id=?').all(id);
  return { id:user.id, username:user.username, role:user.role, coins:user.coins, roomLayout:JSON.parse(user.room_layout||'{}'), inventory };
}
function getRequiredUser(ctx) {
  if (!ctx.user) { json(ctx.res,401,{error:'Please sign in to save your progress.'}); return false; }
  return true;
}
function getRequiredAdmin(ctx) {
  if (!ctx.user || ctx.user.role!=='admin') { json(ctx.res,403,{error:'Keeper access required.'}); return false; }
  return true;
}
async function createDailyBooklet(date, { force=false, useLLM=true } = {}) {
  const existing=getBookletByDate(date);
  if(existing&&!force)return {booklet:existing,skipped:true,message:`A booklet already exists for ${date}.`};
  const seed=`${date}:${crypto.randomUUID()}`;let content;let generator='Built-in puzzle engine';let warning='';
  if(useLLM){
    const model=getSetting('ollama_model')||process.env.OLLAMA_MODEL||'qwen3:4b';
    try{
      const result=await callOllama({baseUrl:OLLAMA_URL,model,date,timeoutMs:Number(process.env.OLLAMA_TIMEOUT_MS||180000)});
      const brief=result.brief;
      const mystery={killer:brief.killer,victim:brief.victim,motive:brief.motive,location:brief.location,weapon:brief.weapon,time:brief.time,title:brief.title};
      content=engine.generateBooklet(date,seed,mystery,brief);content.story=brief.story;
      content.creative={opening:brief.opening,instructions:brief.instructions,hints:brief.hints,wordSearchWords:brief.wordSearchWords,tone:'cozy mystery',model:result.model};
      generator=`Ollama · ${result.model}`;
    }catch(error){warning=`Local LLM unavailable or returned invalid content (${error.message}). A verified built-in booklet was created instead.`;content=engine.generateBooklet(date,seed);}
  }else content=engine.generateBooklet(date,seed);
  const validation=engine.validateBooklet(content);
  if(validation.length)throw new Error(`Booklet validation failed: ${validation.join(' ')}`);
  if(existing){
    db.prepare(`UPDATE booklets SET title=?,status='draft',content_json=?,validation_json=?,generator=?,youtube_url='',approved_at=NULL,published_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(content.title,JSON.stringify(content),JSON.stringify(validation),generator,existing.id);
  }else{
    db.prepare(`INSERT INTO booklets(publish_date,title,status,content_json,validation_json,generator) VALUES(?,?,'draft',?,?,?)`).run(date,content.title,JSON.stringify(content),JSON.stringify(validation),generator);
  }
  return {booklet:getBookletByDate(date),skipped:false,warning};
}
function publishApprovedForDate(date){
  const booklet=getBookletByDate(date);
  if(!booklet||booklet.status!=='approved')return {published:false,reason:'No approved booklet is scheduled for this date.'};
  const errors=engine.validateBooklet(booklet.content);if(errors.length)return {published:false,reason:`Validation failed: ${errors.join(' ')}`};
  db.prepare("UPDATE booklets SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(booklet.id);
  return {published:true,booklet:getBooklet(booklet.id)};
}
function checkPuzzle(content,key,submission){
  const p=content.puzzles;
  switch(key){
    case 'wordsearch':{const found=Array.isArray(submission?.foundWords)?submission.foundWords:[];return p.wordsearch.words.every(w=>found.includes(w))&&found.length>=p.wordsearch.words.length?{ok:true,clue:content.mystery.motive}:{ok:false,message:'Keep looking. Every hidden word must be found.'};}
    case 'sudoku':{const grid=Array.isArray(submission?.grid)?submission.grid.map(Number):[];const ok=grid.length===36&&grid.every((n,i)=>n===p.sudoku.solution[i]);return ok?{ok:true,clue:content.mystery.location}:{ok:false,message:'Not quite. Check every row, column and 2×3 box.'};}
    case 'number':return Number(submission?.answer)===p.number.answer?{ok:true,clue:content.mystery.time}:{ok:false,message:'Look at how the gaps change. Try again.'};
    case 'murdoku':{const placements=submission?.placements||{},expected=p.murdoku.solution,keys=Object.keys(expected);const ok=keys.every(name=>Number(placements[name])===Number(expected[name]))&&Object.keys(placements).length===keys.length;return ok?{ok:true,clue:content.mystery.killer}:{ok:false,message:'Some placements are still incorrect. Revisit the clues and crossed-out rows.'};}
    case 'hidden':{const found=Array.isArray(submission?.foundIds)?submission.foundIds:[];const all=p.hidden.targets.every(t=>found.includes(t.id));return all&&submission?.weaponFound===true?{ok:true,clue:content.mystery.weapon}:{ok:false,message:'Find the three garden objects, then inspect the revealed final object.'};}
    default:return {ok:false,message:'Unknown puzzle.'};
  }
}
function serveStatic(res, filePath) {
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
  fs.readFile(filePath,(err,buffer)=>{if(err)return text(res,404,'Not found');res.writeHead(200,{'Content-Type':mime[path.extname(filePath)]||'application/octet-stream','Content-Length':buffer.length,'Cache-Control':path.extname(filePath)==='.html'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff'});res.end(buffer);});
}

// Authentication routes.
route('POST',/^\/api\/auth\/register$/,ctx=>{
  const username=String(ctx.body.username||'').trim(),password=String(ctx.body.password||'');
  if(!/^[a-zA-Z0-9_]{3,20}$/.test(username))return json(ctx.res,400,{error:'Username must be 3–20 characters (letters, numbers or underscore).'});
  if(password.length<8)return json(ctx.res,400,{error:'Password must contain at least 8 characters.'});
  try{const r=db.prepare("INSERT INTO users(username,password_hash,role,coins) VALUES(?,?,'player',20)").run(username,hashPassword(password));createSession(ctx.res,r.lastInsertRowid);json(ctx.res,200,{user:userSummary(r.lastInsertRowid),message:'Welcome! Here are 20 starter coins for your cozy room.'});}
  catch(e){if(String(e.message).includes('UNIQUE'))return json(ctx.res,409,{error:'That username is already taken.'});json(ctx.res,500,{error:'Could not create account.'});}
});
route('POST',/^\/api\/auth\/login$/,ctx=>{
  const username=String(ctx.body.username||'').trim(),password=String(ctx.body.password||'');
  const user=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
  if(!user||!verifyPassword(password,user.password_hash))return json(ctx.res,401,{error:'Incorrect username or password.'});
  createSession(ctx.res,user.id);json(ctx.res,200,{user:userSummary(user.id)});
});
route('POST',/^\/api\/auth\/logout$/,ctx=>{const sid=parseCookies(ctx.req.headers.cookie)['cozy.sid'];if(sid)db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);ctx.res.setHeader('Set-Cookie','cozy.sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');json(ctx.res,200,{ok:true});});
route('GET',/^\/api\/auth\/me$/,ctx=>json(ctx.res,200,{user:ctx.user?userSummary(ctx.user.id):null}));
route('GET',/^\/api\/public\/booklet$/,ctx=>{
  const date=dateInZone(),row=db.prepare("SELECT * FROM booklets WHERE publish_date=? AND status='published'").get(date);
  if(!row)return json(ctx.res,200,{booklet:null,date,countdownTarget:'midnight'});
  const record={...row,content:JSON.parse(row.content_json)};json(ctx.res,200,{booklet:safeBooklet(record),date,countdownTarget:'midnight'});
});
route('GET',/^\/api\/booklets\/(\d+)\/progress$/,ctx=>{
  if(!getRequiredUser(ctx))return;const record=getBooklet(ctx.params[0]);if(!record||record.status!=='published')return json(ctx.res,404,{error:'Booklet not found.'});
  const completed=db.prepare('SELECT puzzle_key FROM puzzle_progress WHERE user_id=? AND booklet_id=?').all(ctx.user.id,record.id).map(r=>r.puzzle_key);
  const solved=!!db.prepare('SELECT 1 FROM case_solves WHERE user_id=? AND booklet_id=?').get(ctx.user.id,record.id);const m=record.content.mystery;
  const clueMap={wordsearch:m.motive,sudoku:m.location,number:m.time,murdoku:m.killer,hidden:m.weapon};const clues=Object.fromEntries(completed.map(k=>[k,clueMap[k]]));
  json(ctx.res,200,{completed,solved,clues,story:solved?record.content.story:'',user:userSummary(ctx.user.id)});
});
route('POST',/^\/api\/booklets\/(\d+)\/check\/([a-z]+)$/,ctx=>{
  if(!getRequiredUser(ctx))return;const record=getBooklet(ctx.params[0]);const key=ctx.params[1];if(!record||record.status!=='published')return json(ctx.res,404,{error:'Booklet not found.'});if(!VALID_KEYS.includes(key))return json(ctx.res,400,{error:'Unknown puzzle.'});
  const result=checkPuzzle(record.content,key,ctx.body);if(!result.ok)return json(ctx.res,400,result);
  const inserted=db.prepare('INSERT OR IGNORE INTO puzzle_progress(user_id,booklet_id,puzzle_key) VALUES(?,?,?)').run(ctx.user.id,record.id,key);
  if(inserted.changes)db.prepare('UPDATE users SET coins=coins+5 WHERE id=?').run(ctx.user.id);
  json(ctx.res,200,{ok:true,clue:result.clue,reward:inserted.changes?5:0,user:userSummary(ctx.user.id),message:'Puzzle solved! You earned 5 coins.'});
});
route('POST',/^\/api\/booklets\/(\d+)\/accuse$/,ctx=>{
  if(!getRequiredUser(ctx))return;const record=getBooklet(ctx.params[0]);if(!record||record.status!=='published')return json(ctx.res,404,{error:'Booklet not found.'});
  const userId=ctx.user.id;const completed=db.prepare('SELECT puzzle_key FROM puzzle_progress WHERE user_id=? AND booklet_id=?').all(userId,record.id).map(r=>r.puzzle_key);
  if(!VALID_KEYS.every(k=>completed.includes(k)))return json(ctx.res,400,{error:'Complete all five puzzles before making an accusation.'});
  const m=record.content.mystery,a=ctx.body;const correct=a.killer===m.killer&&a.motive===m.motive&&a.location===m.location&&a.weapon===m.weapon;if(!correct)return json(ctx.res,400,{error:'Not quite. Revisit your clue board and try again.'});
  const inserted=db.prepare('INSERT OR IGNORE INTO case_solves(user_id,booklet_id) VALUES(?,?)').run(userId,record.id);if(inserted.changes)db.prepare('UPDATE users SET coins=coins+25 WHERE id=?').run(userId);
  json(ctx.res,200,{ok:true,story:record.content.story,title:record.content.title,youtubeUrl:record.youtube_url,reward:inserted.changes?25:0,user:userSummary(userId)});
});
route('GET',/^\/api\/shop$/,ctx=>{if(!getRequiredUser(ctx))return;json(ctx.res,200,{items:SHOP_ITEMS,user:userSummary(ctx.user.id)});});
route('POST',/^\/api\/shop\/buy$/,ctx=>{
  if(!getRequiredUser(ctx))return;const item=SHOP_ITEMS.find(x=>x.id===ctx.body.itemId);if(!item)return json(ctx.res,404,{error:'That decoration is not in the shop.'});
  const userId=ctx.user.id,owned=db.prepare('SELECT quantity FROM inventory WHERE user_id=? AND item_id=?').get(userId,item.id);if(owned)return json(ctx.res,409,{error:'You already own this decoration.'});
  const user=db.prepare('SELECT coins FROM users WHERE id=?').get(userId);if(user.coins<item.cost)return json(ctx.res,400,{error:'Not enough coins yet. Solve another puzzle to earn more.'});
  db.exec('BEGIN');try{db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(item.cost,userId);db.prepare('INSERT INTO inventory(user_id,item_id,quantity) VALUES(?,?,1)').run(userId,item.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  json(ctx.res,200,{ok:true,user:userSummary(userId),message:`${item.name} is now yours!`});
});
route('PUT',/^\/api\/room\/layout$/,ctx=>{
  if(!getRequiredUser(ctx))return;const layout=ctx.body.layout;if(!layout||typeof layout!=='object'||Array.isArray(layout))return json(ctx.res,400,{error:'Invalid room layout.'});
  const owned=new Set(db.prepare('SELECT item_id FROM inventory WHERE user_id=?').all(ctx.user.id).map(r=>r.item_id));for(const itemId of Object.values(layout))if(itemId&&!owned.has(itemId))return json(ctx.res,403,{error:'You can only place decorations you own.'});
  db.prepare('UPDATE users SET room_layout=? WHERE id=?').run(JSON.stringify(layout),ctx.user.id);json(ctx.res,200,{ok:true,user:userSummary(ctx.user.id)});
});

// Keeper/admin APIs.
route('GET',/^\/api\/admin\/ollama-status$/,async ctx=>{
  if(!getRequiredAdmin(ctx))return;const status=await getOllamaStatus(OLLAMA_URL),model=getSetting('ollama_model')||process.env.OLLAMA_MODEL||'qwen3:4b';json(ctx.res,200,{...status,model,baseUrl:OLLAMA_URL});
});
route('POST',/^\/api\/admin\/ollama-model$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const model=String(ctx.body.model||'').trim();if(!/^[a-zA-Z0-9._:/-]{2,100}$/.test(model))return json(ctx.res,400,{error:'Invalid model name.'});
  setSetting('ollama_model',model);json(ctx.res,200,{ok:true,model});
});
route('GET',/^\/api\/admin\/booklets$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const rows=db.prepare('SELECT id,publish_date,title,status,generator,validation_json,youtube_url,created_at,updated_at FROM booklets ORDER BY publish_date DESC LIMIT 40').all();
  json(ctx.res,200,{booklets:rows.map(r=>({...r,validation:JSON.parse(r.validation_json)}))});
});
route('GET',/^\/api\/admin\/booklets\/(\d+)$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]);if(!b)return json(ctx.res,404,{error:'Booklet not found.'});
  json(ctx.res,200,{booklet:{id:b.id,date:b.publish_date,title:b.title,status:b.status,generator:b.generator,validation:b.validation,youtubeUrl:b.youtube_url,created_at:b.created_at,content:b.content}});
});
route('GET',/^\/api\/admin\/booklets\/(\d+)\/play$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]);if(!b)return json(ctx.res,404,{error:'Booklet not found.'});json(ctx.res,200,{booklet:safeBooklet(b)});
});
route('POST',/^\/api\/admin\/booklets\/(\d+)\/check\/([a-z]+)$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]),key=ctx.params[1];if(!b)return json(ctx.res,404,{error:'Booklet not found.'});if(!VALID_KEYS.includes(key))return json(ctx.res,400,{error:'Unknown puzzle.'});const result=checkPuzzle(b.content,key,ctx.body);json(ctx.res,result.ok?200:400,result);
});
route('POST',/^\/api\/admin\/booklets\/(\d+)\/accuse$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]);if(!b)return json(ctx.res,404,{error:'Booklet not found.'});const m=b.content.mystery,a=ctx.body;const correct=a.killer===m.killer&&a.motive===m.motive&&a.location===m.location&&a.weapon===m.weapon;if(!correct)return json(ctx.res,400,{error:'The accusation does not match the answer key.'});json(ctx.res,200,{ok:true,story:b.content.story,title:b.content.title,youtubeUrl:b.youtube_url});
});
route('POST',/^\/api\/admin\/generate$/,async ctx=>{
  if(!getRequiredAdmin(ctx))return;const date=String(ctx.body.date||addDays(dateInZone(),1));if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json(ctx.res,400,{error:'Use a valid date (YYYY-MM-DD).'});
  try{const result=await createDailyBooklet(date,{force:ctx.body.force===true,useLLM:ctx.body.useLLM!==false});json(ctx.res,200,{ok:true,id:result.booklet.id,date,title:result.booklet.title,status:result.booklet.status,generator:result.booklet.generator,validation:result.booklet.validation,warning:result.warning||'',skipped:result.skipped,message:result.message||'Booklet generated and validated.'});}
  catch(e){json(ctx.res,500,{error:e.message});}
});
route('POST',/^\/api\/admin\/booklets\/(\d+)\/regenerate\/([a-z]+)$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const record=getBooklet(ctx.params[0]),key=ctx.params[1];if(!record)return json(ctx.res,404,{error:'Booklet not found.'});if(!VALID_KEYS.includes(key))return json(ctx.res,400,{error:'Unknown puzzle section.'});
  try{record.content.puzzles[key]=engine.regeneratePuzzle(record.content,key,`${record.publish_date}:${crypto.randomUUID()}`);const validation=engine.validateBooklet(record.content);if(validation.length)return json(ctx.res,422,{error:'The regenerated booklet did not pass validation.',validation});
    db.prepare("UPDATE booklets SET status='draft',content_json=?,validation_json=?,approved_at=NULL,published_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(record.content),JSON.stringify(validation),record.id);json(ctx.res,200,{ok:true,validation,message:`${key} regenerated. The booklet has returned to draft status and needs approval again.`});}
  catch(e){json(ctx.res,500,{error:e.message});}
});
route('PUT',/^\/api\/admin\/booklets\/(\d+)\/youtube$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]);if(!b)return json(ctx.res,404,{error:'Booklet not found.'});const url=String(ctx.body.url||'').trim();if(url&&!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url))return json(ctx.res,400,{error:'Enter a valid YouTube URL.'});db.prepare('UPDATE booklets SET youtube_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(url,b.id);json(ctx.res,200,{ok:true,url});
});
route('POST',/^\/api\/admin\/booklets\/(\d+)\/approve$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]);if(!b)return json(ctx.res,404,{error:'Booklet not found.'});if(b.publish_date<=dateInZone())return json(ctx.res,400,{error:'Approve a future-dated booklet. The midnight job publishes only the booklet prepared for the new day.'});const errors=engine.validateBooklet(b.content);if(errors.length)return json(ctx.res,422,{error:'This booklet cannot be approved until it passes validation.',validation:errors});if(!b.youtube_url)return json(ctx.res,400,{error:'Add the YouTube solution URL before approving.'});db.prepare("UPDATE booklets SET status='approved',approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(b.id);json(ctx.res,200,{ok:true,message:`Approved for automatic publication on ${b.publish_date} at midnight (${TZ}).`});
});
route('POST',/^\/api\/admin\/booklets\/(\d+)\/publish-now$/,ctx=>{
  if(!getRequiredAdmin(ctx))return;const b=getBooklet(ctx.params[0]);if(!b)return json(ctx.res,404,{error:'Booklet not found.'});const errors=engine.validateBooklet(b.content);if(errors.length)return json(ctx.res,422,{error:'Validation failed.',validation:errors});db.prepare("UPDATE booklets SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(b.id);json(ctx.res,200,{ok:true,message:'Booklet published immediately for local testing.'});
});
route('GET',/^\/api\/admin\/scheduler$/,ctx=>{if(!getRequiredAdmin(ctx))return;json(ctx.res,200,{timezone:TZ,now:nowInZone(),generation:'18:00 daily (tomorrow’s booklet)',publication:'00:00 daily (approved booklet for today)',requiresServerRunning:true});});

async function dispatch(req,res){
  let url;try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`);}catch{return text(res,400,'Bad request');}
  const method=req.method||'GET';let body={};
  if(!['GET','HEAD'].includes(method)){try{body=await readBody(req);}catch(e){return json(res,400,{error:e.message.includes('JSON')?'Invalid JSON body.':e.message});}}
  const ctx={req,res,url,body,user:currentUser(req),params:[]};
  for(const r of ROUTES){if(r.method!==method)continue;const match=url.pathname.match(r.pattern);if(match){ctx.params=match.slice(1);try{await r.handler(ctx);}catch(e){console.error('[request error]',method,url.pathname,e);if(!res.headersSent)json(res,500,{error:'An unexpected local server error occurred.'});}return;}}
  if(method==='GET'&&url.pathname===ADMIN_PATH)return serveStatic(res,path.join(PUBLIC,'admin.html'));
  if(method==='GET'||method==='HEAD'){
    let filePath=path.join(PUBLIC,decodeURIComponent(url.pathname).replace(/^\/+/,''));
    if(filePath!==PUBLIC&&!filePath.startsWith(PUBLIC+path.sep))return text(res,403,'Forbidden');
    if(url.pathname==='/'||url.pathname==='/play')filePath=path.join(PUBLIC,'index.html');
    try{if(fs.statSync(filePath).isDirectory())filePath=path.join(filePath,'index.html');if(fs.statSync(filePath).isFile())return serveStatic(res,filePath);}catch{}
    if(url.pathname.startsWith('/api/'))return json(res,404,{error:'API route not found.'});
    return serveStatic(res,path.join(PUBLIC,'index.html'));
  }
  json(res,404,{error:'Route not found.'});
}

let schedulerBusy=false;
async function schedulerTick(){
  if(schedulerBusy)return;schedulerBusy=true;
  try{
    const today=dateInZone(),clock=nowInZone();
    if(clock>='18:00'&&getSetting('last_generation_run')!==today){
      setSetting('last_generation_run',today);
      const target=addDays(today,1);
      try{const result=await createDailyBooklet(target,{force:false,useLLM:true});console.log(`[scheduler] ${result.skipped?'kept':'generated'} booklet for ${target}: ${result.booklet.title}`);if(result.warning)console.warn('[scheduler]',result.warning);}
      catch(e){console.error('[scheduler] generation failed:',e.message);setSetting('last_generation_error',`${today}: ${e.message}`);}
    }
    if(clock>='00:00'&&getSetting('last_publication_run')!==today){
      const result=publishApprovedForDate(today);setSetting('last_publication_run',today);console.log(`[scheduler] midnight publication for ${today}:`,result.published?'published':result.reason);
    }
  }finally{schedulerBusy=false;}
}

const server=http.createServer((req,res)=>{res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','same-origin');dispatch(req,res);});
server.listen(PORT, process.env.HOST || '127.0.0.1', ()=>{
  console.log(`\ncozymystrybook is running at http://localhost:${PORT}`);
  console.log(`Keeper dashboard: http://localhost:${PORT}${ADMIN_PATH}`);
  console.log(`Local timezone: ${TZ}`);
  console.log('No npm packages are required. Keep this terminal and Ollama running for scheduled jobs.\n');
  schedulerTick();setInterval(schedulerTick,15000).unref();
});
