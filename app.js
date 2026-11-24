'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  user: null, booklet: null, preview: false, previewId: null,
  completed: {}, clues: {}, solved: false, story: '',
  page: 'home', currentPuzzle: 'wordsearch', authMode: 'login',
  wordSelected: [], wordFound: [], wordFoundCells: [], sudokuGrid: [], sudokuNotes: {}, sudokuNumber: 1, sudokuPencil: false, sudokuHistory: [],
  mdPlaced: {}, mdNotes: {}, mdSelected: 0, mdMode: 'place', mdHistory: [],
  hiddenFound: [], hiddenWeaponFound: false, hiddenHintIndex: 0,
  inventory: [], roomLayout: {}, selectedItemId: null, shopItems: []
};
const PUZZLES = [
  ['wordsearch','01','Word search','Find the motive'],
  ['sudoku','02','Mini Sudoku','Find the room'],
  ['number','03','Number pattern','Find the time'],
  ['murdoku','04','Murdoku','Find the killer'],
  ['hidden','05','Hidden objects','Find the weapon'],
  ['accuse','✦','Make an accusation','Close the case']
];
const SUSPECTS = ['Lady Ivy','Mr. Finch','Dr. Rose','Miss Pip'];
const MOTIVES = ['Stolen Recipe','Jealousy','Blackmail','Hidden Debt','Inheritance'];
const LOCATIONS = ['Kitchen','Library','Conservatory','Cellar'];
const WEAPONS = ['Silver Candlestick','Garden Shears','Poisoned Scone','Antique Letter Opener','Heavy Brass Teapot'];
const PEOPLE_ICONS = {'Lady Ivy':'👵','Mr. Finch':'🎩','Dr. Rose':'🧑‍⚕️','Miss Pip':'👩‍🍳','Lady Marigold':'🪦'};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let toastTimer;
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}
function showPage(page) {
  state.page = page;
  $('#homePage').hidden = page !== 'home';
  $('#roomPage').hidden = page !== 'room';
  $('#rulesPage').hidden = page !== 'rules';
  $$('[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  if (page === 'room') renderRoom();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setCountdown() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
  const tomorrow = new Date(Date.UTC(Number(values.year), Number(values.month)-1, Number(values.day)+1) - 330*60*1000);
  const diff = Math.max(0, tomorrow.getTime() - now.getTime());
  const h = String(Math.floor(diff/3600000)).padStart(2,'0');
  const m = String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
  const s = String(Math.floor((diff%60000)/1000)).padStart(2,'0');
  $('#headerCountdown').textContent = `${h}:${m}:${s}`;
}
function updateAccount() {
  const area = $('#accountArea');
  if (!state.user) {
    area.innerHTML = '<button class="button button-small button-outline" id="signInButton">Sign in</button>';
    $('#signInButton').onclick = () => openAuth('login');
  } else {
    area.innerHTML = `<div class="account-pill"><span>☕ ${escapeHtml(state.user.username)}</span><button class="button button-small button-outline" id="logoutButton">Sign out</button></div>`;
    $('#logoutButton').onclick = logout;
  }
  $('#roomCoins').textContent = state.user?.coins ?? 0;
}
function openAuth(mode = 'login') {
  state.authMode = mode;
  $('#authHeading').textContent = mode === 'login' ? 'Welcome back.' : 'Make yourself at home.';
  $('#authSub').textContent = mode === 'login' ? 'Sign in to save your clues, coins and room.' : 'Create a little account for your clues, coins and room.';
  $('#authSubmit').textContent = mode === 'login' ? 'Enter the room ↗' : 'Create my room ↗';
  $('#authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $$('.auth-switch button').forEach(b => b.classList.toggle('active', b.dataset.authMode === mode));
  $('#authMessage').textContent = '';
  $('#authModal').hidden = false;
}
function closeAuth() { $('#authModal').hidden = true; }
async function authSubmit(event) {
  event.preventDefault();
  const payload = { username: $('#authUsername').value.trim(), password: $('#authPassword').value };
  $('#authMessage').textContent = 'Just a moment…';
  try {
    const result = await api(`/api/auth/${state.authMode === 'register' ? 'register' : 'login'}`, { method:'POST', body: payload });
    state.user = result.user; closeAuth(); updateAccount(); await loadProgress(); await loadShop(); renderRoom(); toast(result.message || `Welcome, ${state.user.username}.`);
    if (state.pendingOpen) { state.pendingOpen = false; showPage('room'); if (state.booklet) openBooklet(); }
  } catch (error) { $('#authMessage').textContent = error.message; }
}
async function logout() {
  await api('/api/auth/logout', { method:'POST', body:{} });
  state.user = null; state.completed = {}; state.clues = {}; state.solved = false; updateAccount(); renderRoom(); toast('You have signed out.');
}
async function loadProgress() {
  if (!state.booklet || state.preview || !state.user) return;
  try {
    const data = await api(`/api/booklets/${state.booklet.id}/progress`);
    state.completed = Object.fromEntries(data.completed.map(k => [k,true]));
    state.clues = data.clues || {};
    state.solved = data.solved;
    state.user = data.user || state.user;
    if (data.story) state.story = data.story;
  } catch { /* A booklet may not be published yet. */ }
  renderClueBoard(); updateAccount();
}
async function loadPublicBooklet() {
  try {
    const data = await api('/api/public/booklet');
    state.booklet = data.booklet;
    if (state.booklet && state.user) await loadProgress();
    updateRoomCaseCard();
  } catch (error) { console.error(error); }
}
async function loadPreview(id) {
  state.preview = true; state.previewId = id;
  try {
    const data = await api(`/api/admin/booklets/${id}/play`);
    state.booklet = data.booklet;
    state.completed = {}; state.clues = {}; state.solved = false;
    updateRoomCaseCard(); showPage('room'); openBooklet();
    toast('Keeper preview: puzzle checks do not award player coins.');
  } catch (error) { toast(`Preview could not be opened: ${error.message}`); }
}
function updateRoomCaseCard() {
  if (!state.booklet) {
    $('#roomCaseTitle').textContent = 'A new mystery is being prepared';
    $('#roomCaseSub').textContent = 'Come back when the next case is published.';
  } else {
    $('#roomCaseTitle').textContent = state.booklet.title;
    $('#roomCaseSub').textContent = `${Object.keys(state.completed).length}/5 chapters solved · ${state.booklet.date}`;
  }
}
function updateClueState(key, value) {
  state.completed[key] = true;
  const map = { wordsearch:['Motive',value], sudoku:['Location',value], number:['Time',value], murdoku:['Killer',value], hidden:['Weapon',value] };
  state.clues[key] = map[key]?.[1] ?? value;
  renderClueBoard(); renderTabs(); updateRoomCaseCard();
}
function renderClueBoard() {
  const map = [ ['wordsearch','Motive'],['sudoku','Location'],['number','Time'],['murdoku','Killer'],['hidden','Weapon'] ];
  $('#clueBoard').innerHTML = map.map(([key,label]) => `<div class="clue-slot ${state.completed[key]?'found':''}"><small>${label}</small><b>${escapeHtml(state.clues[key] || 'Waiting for a clue')}</b></div>`).join('');
}
function renderTabs() {
  $('#puzzleTabs').innerHTML = PUZZLES.map(([key,num,label,sub]) => `<button class="puzzle-tab ${state.currentPuzzle===key?'active':''} ${state.completed[key]?'done':''}" data-tab="${key}">${num} · ${label}</button>`).join('');
  $$('[data-tab]', $('#puzzleTabs')).forEach(btn => btn.onclick = () => { state.currentPuzzle = btn.dataset.tab; renderTabs(); renderPuzzle(); });
}
function openBooklet() {
  if (state.preview) { /* keeper preview can play without a player account */ }
  else if (!state.user) { state.pendingOpen = true; openAuth('login'); return; }
  if (!state.booklet) { toast('No approved booklet is published for today yet.'); return; }
  $('#bookletDate').textContent = `${state.preview ? 'KEEPER PREVIEW' : 'TODAY’S LITTLE CASE'} · ${state.booklet.date}`;
  $('#bookletTitle').textContent = state.booklet.title;
  $('#bookletOpening').textContent = state.booklet.opening || '';
  $('#bookletOverlay').hidden = false;
  state.currentPuzzle = 'wordsearch';
  if (!state.sudokuGrid.length) resetPuzzleMemory();
  renderClueBoard(); renderTabs(); renderPuzzle();
}
function closeBooklet() {
  $('#bookletOverlay').hidden = true;
  if (state.solved) showPage('room');
  updateRoomCaseCard(); renderRoom();
}
function resetPuzzleMemory() {
  state.wordSelected = []; state.wordFound = []; state.wordFoundCells = [];
  state.sudokuGrid = state.booklet?.puzzles?.sudoku?.givens?.slice() || [];
  state.sudokuNotes = {}; state.sudokuNumber = 1; state.sudokuPencil = false; state.sudokuHistory = [];
  state.mdPlaced = {}; state.mdNotes = {}; state.mdSelected = 0; state.mdMode = 'place'; state.mdHistory = [];
  state.hiddenFound = []; state.hiddenWeaponFound = false; state.hiddenHintIndex = 0;
}
function renderPuzzle() {
  if (!state.booklet) return;
  const key = state.currentPuzzle;
  if (key === 'wordsearch') return renderWordSearch();
  if (key === 'sudoku') return renderSudoku();
  if (key === 'number') return renderNumber();
  if (key === 'murdoku') return renderMurdoku();
  if (key === 'hidden') return renderHidden();
  return renderAccusation();
}
function puzzleHeader(title, copy, key) {
  return `<div class="puzzle-title-row"><div><p class="eyebrow">CHAPTER ${PUZZLES.findIndex(x=>x[0]===key)+1} · ${escapeHtml(PUZZLES.find(x=>x[0]===key)?.[3]||'THE CASE')}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div></div>`;
}
function setMessage(message, good = false) {
  const el = $('.status-message', $('#puzzleBody'));
  if (el) { el.textContent = message; el.classList.toggle('good', good); }
}
function renderWordSearch() {
  const p = state.booklet.puzzles.wordsearch;
  const copy = p.instructions || 'Find all the words hidden in the letter garden. Tap letters in order to form a word.';
  $('#puzzleBody').innerHTML = `${puzzleHeader('Letters in the garden',copy,'wordsearch')}<div class="puzzle-help">Choose letters in order. Words can run left, right, up, down or diagonally. A found word will be tucked into your clue book.</div><div class="word-bank">${p.words.map(w=>`<span class="word-chip ${state.wordFound.includes(w)?'found':''}">${escapeHtml(w)}</span>`).join('')}</div><div class="puzzle-grid word-grid">${p.grid.map((letter,i)=>`<button class="puzzle-cell ${state.wordSelected.includes(i)?'selected':''} ${isWordCellFound(i)?'found':''}" data-ws-cell="${i}">${escapeHtml(letter)}</button>`).join('')}</div><div class="puzzle-controls"><button class="small-button" data-action="word-clear">Clear selected letters</button><button class="small-button" data-action="word-hint">A little hint</button></div><p class="status-message ${state.completed.wordsearch?'good':''}">${state.completed.wordsearch?'Motive clue collected: '+escapeHtml(state.clues.wordsearch):`${state.wordFound.length} of ${p.words.length} words found.`}</p>`;
  $('#puzzleBody').onclick = handleWordClick;
}
function isWordCellFound(index) {
  const p = state.booklet.puzzles.wordsearch;
  return state.wordFoundCells.includes(index);
}
function handleWordClick(event) {
  const cell = event.target.closest('[data-ws-cell]');
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'word-clear') { state.wordSelected = []; renderWordSearch(); return; }
  if (action === 'word-hint') { toast(state.booklet.creative?.hints?.wordsearch || 'Try looking for words connected to the case.'); return; }
  if (!cell || state.completed.wordsearch) return;
  const index = Number(cell.dataset.wsCell);
  if (state.wordSelected.includes(index)) return;
  if(state.wordSelected.length>=2){
    const first=state.wordSelected[0],second=state.wordSelected[1];
    const r0=Math.floor(first/9),c0=first%9,r1=Math.floor(second/9),c1=second%9;
    const dr=Math.sign(r1-r0),dc=Math.sign(c1-c0),step=state.wordSelected.length;
    const expected=(r0+dr*step)*9+(c0+dc*step);
    if(expected!==index){state.wordSelected=[index];renderWordSearch();return;}
  }else if(state.wordSelected.length===1){
    const first=state.wordSelected[0],dr=Math.abs(Math.floor(index/9)-Math.floor(first/9)),dc=Math.abs(index%9-first%9);
    if(Math.max(dr,dc)!==1){state.wordSelected=[index];renderWordSearch();return;}
  }
  state.wordSelected.push(index);
  const letters = state.wordSelected.map(i => state.booklet.puzzles.wordsearch.grid[i]).join('');
  const match = state.booklet.puzzles.wordsearch.words.find(w => !state.wordFound.includes(w) && (w === letters || w === [...letters].reverse().join('')));
  const prefix = state.booklet.puzzles.wordsearch.words.some(w => !state.wordFound.includes(w) && (w.startsWith(letters) || w.endsWith(letters)));
  if (match) { state.wordFound.push(match); state.wordFoundCells.push(...state.wordSelected); state.wordSelected = []; }
  else if (!prefix || state.wordSelected.length > 9) state.wordSelected = [index];
  renderWordSearch();
  if (state.wordFound.length === state.booklet.puzzles.wordsearch.words.length) completePuzzle('wordsearch',{foundWords:state.wordFound});
}
function sudokuSnapshot() { return { grid:state.sudokuGrid.slice(), notes:JSON.parse(JSON.stringify(state.sudokuNotes)) }; }
function sudokuPush() { state.sudokuHistory.push(sudokuSnapshot()); if (state.sudokuHistory.length>200) state.sudokuHistory.shift(); }
function renderSudoku() {
  const p = state.booklet.puzzles.sudoku;
  const keyIndex = p.keyIndex;
  const grid = p.givens.map((v,i)=>v || state.sudokuGrid[i] || 0);
  const conflicts = new Set();
  for (let i=0;i<36;i++) if (grid[i]) {
    const r=Math.floor(i/6),c=i%6,boxR=Math.floor(r/2)*2,boxC=Math.floor(c/3)*3;
    for(let k=0;k<6;k++){const ri=r*6+k,ci=k*6+c;if(k!==c&&grid[ri]===grid[i]){conflicts.add(i);conflicts.add(ri)}if(k!==r&&grid[ci]===grid[i]){conflicts.add(i);conflicts.add(ci)}}
    for(let rr=0;rr<2;rr++)for(let cc=0;cc<3;cc++){const j=(boxR+rr)*6+boxC+cc;if(j!==i&&grid[j]===grid[i]){conflicts.add(i);conflicts.add(j)}}
  }
  $('#puzzleBody').innerHTML = `${puzzleHeader('The golden square',p.instructions,'sudoku')}<div class="puzzle-help">The golden square is the room code: 1–2 Kitchen · 3 Library · 4–5 Conservatory · 6 Cellar. Choose a number, then tap a square. Pencil mode keeps small notes. Undo and Reset are always available.</div><div class="number-pad">${[1,2,3,4,5,6].map(n=>`<button class="${state.sudokuNumber===n?'active':''}" data-sd-num="${n}">${n}</button>`).join('')}</div><div class="puzzle-controls" style="justify-content:center"><button class="small-button ${state.sudokuPencil?'active':''}" data-action="sd-pencil">✎ Pencil ${state.sudokuPencil?'on':'off'}</button><button class="small-button" data-action="sd-undo">↶ Undo</button><button class="small-button" data-action="sd-reset">↺ Reset</button><button class="small-button" data-action="sd-check">Check grid</button></div><div class="sudoku-grid">${grid.map((value,i)=>{const given=p.givens[i]!==0;const notes=state.sudokuNotes[i]||[];return `<button class="sudoku-cell ${given?'given':''} ${i===keyIndex?'golden':''} ${conflicts.has(i)?'bad':''} ${i%3===2&&i%6!==5?'box-right':''} ${Math.floor(i/6)%2===1?'box-bottom':''}" data-sd-cell="${i}" ${given?'disabled':''}>${value||''}${!value&&notes.length?`<span class="notes">${notes.join(' · ')}</span>`:''}</button>`}).join('')}</div><p class="status-message ${state.completed.sudoku?'good':''}">${state.completed.sudoku?'Location clue collected: '+escapeHtml(state.clues.sudoku):'Fill every square, then check your grid.'}</p>`;
  $('#puzzleBody').onclick = handleSudokuClick;
}
async function handleSudokuClick(event) {
  const num = event.target.closest('[data-sd-num]');
  const cell = event.target.closest('[data-sd-cell]');
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (num) { state.sudokuNumber=Number(num.dataset.sdNum); renderSudoku(); return; }
  if (action==='sd-pencil') { state.sudokuPencil=!state.sudokuPencil; renderSudoku(); return; }
  if (action==='sd-undo') { const old=state.sudokuHistory.pop();if(old){state.sudokuGrid=old.grid;state.sudokuNotes=old.notes;}renderSudoku();return; }
  if (action==='sd-reset') { sudokuPush();state.sudokuGrid=state.booklet.puzzles.sudoku.givens.slice();state.sudokuNotes={};renderSudoku();return; }
  if (action==='sd-check') { const full=state.sudokuGrid.every((v,i)=>v||state.booklet.puzzles.sudoku.givens[i]);if(!full){setMessage('A few squares are still empty.');return;}await completePuzzle('sudoku',{grid:state.booklet.puzzles.sudoku.givens.map((v,i)=>v||state.sudokuGrid[i]||0)});return; }
  if (!cell || state.completed.sudoku) return;
  const index=Number(cell.dataset.sdCell);sudokuPush();
  if(state.sudokuPencil){const notes=state.sudokuNotes[index]||[];state.sudokuNotes[index]=notes.includes(state.sudokuNumber)?notes.filter(n=>n!==state.sudokuNumber):[...notes,state.sudokuNumber];}
  else{state.sudokuGrid[index]=state.sudokuGrid[index]===state.sudokuNumber?0:state.sudokuNumber;delete state.sudokuNotes[index];}
  renderSudoku();
}
function renderNumber() {
  const p=state.booklet.puzzles.number;
  $('#puzzleBody').innerHTML=`${puzzleHeader('The stopped clock',p.instructions,'number')}<div class="puzzle-help">The mantel clock is known to have stopped at <b>4:__ PM</b>. The next number gives the missing minutes. ${escapeHtml(p.hint || 'Find the pattern in the gaps.')}</div><div class="sequence">${p.sequence.map(n=>`<span>${n}</span>`).join('')}<span>?</span></div><div class="row-center"><input id="numberAnswer" class="answer-input" type="number" placeholder="Next number" aria-label="Next number"><button class="button button-primary" data-action="number-check">Check answer</button></div><p class="status-message ${state.completed.number?'good':''}">${state.completed.number?'Time clue collected: '+escapeHtml(state.clues.number):'What number comes next?'}</p>`;
  $('#puzzleBody').onclick=async event=>{if(event.target.closest('[data-action="number-check"]'))await completePuzzle('number',{answer:$('#numberAnswer').value});};
  $('#numberAnswer')?.addEventListener('keydown',e=>{if(e.key==='Enter')completePuzzle('number',{answer:$('#numberAnswer').value});});
}
function mdSnapshot(){return {placed:{...state.mdPlaced},notes:JSON.parse(JSON.stringify(state.mdNotes)),selected:state.mdSelected,mode:state.mdMode};}
function mdPush(){state.mdHistory.push(mdSnapshot());if(state.mdHistory.length>200)state.mdHistory.shift();}
function renderMurdoku() {
  const p=state.booklet.puzzles.murdoku;
  const people=p.people;
  const rowUsed={},colUsed={};
  Object.entries(state.mdPlaced).forEach(([name,cell])=>{const r=Math.floor(cell/5),c=cell%5;rowUsed[r]=(rowUsed[r]||0)+1;colUsed[c]=(colUsed[c]||0)+1;});
  const conflicts=new Set();Object.entries(state.mdPlaced).forEach(([name,cell])=>{const r=Math.floor(cell/5),c=cell%5;if(rowUsed[r]>1||colUsed[c]>1)conflicts.add(cell);});
  const landmarkLegend=[...new Map(Object.values(p.furniture||{}).map(x=>[x.id,x])).values()].map(x=>`<span>${escapeHtml(x.symbol)} ${escapeHtml(x.name)}</span>`).join('');
  const cells=Array.from({length:25},(_,i)=>{const r=Math.floor(i/5),c=i%5,room=p.rooms[r][c],placed=Object.entries(state.mdPlaced).find(([,v])=>Number(v)===i)?.[0],notes=state.mdNotes[i]||[];const crossed=!placed&&(rowUsed[r]||colUsed[c]);const furniture=p.furniture?.[i]?.symbol||'';const blocked=p.blocked.includes(i);return `<button class="murdoku-cell room-${room} ${blocked?'blocked':''} ${crossed?'crossed':''} ${conflicts.has(i)?'conflict':''}" data-md-cell="${i}" ${blocked?'disabled':''}><small>${escapeHtml(p.roomNames[room])}</small>${placed?`<span class="placed-person">${PEOPLE_ICONS[placed]||'🧍'}</span>`:furniture}<span class="note-people">${notes.map(n=>PEOPLE_ICONS[n]||'·').join('')}</span></button>`;}).join('');
  $('#puzzleBody').innerHTML=`${puzzleHeader('The guest floor plan',p.instructions,'murdoku')}<div class="puzzle-help">Choose a guest, then choose Place or Pencil notes. Each person must appear once, with one person in every row and column. Furniture and room names are part of the clues. Placed guests cross out their row and column.</div><div class="people-picker">${people.map((person,i)=>`<button class="${state.mdSelected===i?'active':''}" data-md-person="${i}">${PEOPLE_ICONS[person]||'🧍'} ${escapeHtml(person)} ${Object.hasOwn(state.mdPlaced,person)?'✓':''}</button>`).join('')}</div><div class="puzzle-controls" style="justify-content:center"><button class="small-button ${state.mdMode==='place'?'active':''}" data-action="md-place">Place guest</button><button class="small-button ${state.mdMode==='notes'?'active':''}" data-action="md-notes">Pencil notes</button><button class="small-button" data-action="md-undo">↶ Undo</button><button class="small-button" data-action="md-reset">↺ Reset</button><button class="small-button" data-action="md-check">Check floor plan</button></div><div class="landmark-legend"><b>Landmarks</b>${landmarkLegend}</div><div class="murdoku-grid">${cells}</div><ul class="murdoku-clues">${p.clues.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul><p class="status-message ${state.completed.murdoku?'good':''}">${state.completed.murdoku?'Killer clue collected: '+escapeHtml(state.clues.murdoku):`${Object.keys(state.mdPlaced).length} of ${people.length} guests placed.`}</p>`;
  $('#puzzleBody').onclick=handleMurdokuClick;
}
async function handleMurdokuClick(event){
  const person=event.target.closest('[data-md-person]');const cell=event.target.closest('[data-md-cell]');const action=event.target.closest('[data-action]')?.dataset.action;
  if(person){state.mdSelected=Number(person.dataset.mdPerson);renderMurdoku();return;}
  if(action==='md-place'||action==='md-notes'){state.mdMode=action==='md-place'?'place':'notes';renderMurdoku();return;}
  if(action==='md-undo'){const old=state.mdHistory.pop();if(old){state.mdPlaced=old.placed;state.mdNotes=old.notes;state.mdSelected=old.selected;state.mdMode=old.mode;}renderMurdoku();return;}
  if(action==='md-reset'){mdPush();state.mdPlaced={};state.mdNotes={};state.mdSelected=0;renderMurdoku();return;}
  if(action==='md-check'){if(Object.keys(state.mdPlaced).length!==5){setMessage('Place all five guests first.');return;}await completePuzzle('murdoku',{placements:state.mdPlaced});return;}
  if(!cell||state.completed.murdoku)return;
  const idx=Number(cell.dataset.mdCell);mdPush();const name=state.booklet.puzzles.murdoku.people[state.mdSelected];
  if(state.mdMode==='notes'){
    const notes=state.mdNotes[idx]||[];state.mdNotes[idx]=notes.includes(name)?notes.filter(n=>n!==name):[...notes,name];
  }else{
    if(state.mdPlaced[name]===idx)delete state.mdPlaced[name];
    else{for(const [other,cellId] of Object.entries(state.mdPlaced))if(other===name||Number(cellId)===idx)delete state.mdPlaced[other];state.mdPlaced[name]=idx;for(const [key,notes] of Object.entries(state.mdNotes))state.mdNotes[key]=notes.filter(n=>n!==name);}
  }
  renderMurdoku();
}
function renderHidden(){
  const p=state.booklet.puzzles.hidden;
  const objects=[...p.clutter.map((o,i)=>({...o,id:`decoy-${i}`,type:'decoy'})),...p.targets.map(t=>({...t,type:'target'}))];
  if(state.hiddenFound.length===p.targets.length)objects.push({id:'weapon',symbol:p.weaponSpot.symbol,x:p.weaponSpot.x,y:p.weaponSpot.y,type:'weapon'});
  const garden=objects.map(o=>`<button class="garden-object ${o.type} ${state.hiddenFound.includes(o.id)||state.hiddenWeaponFound&&o.id==='weapon'?'found':''}" style="left:${o.x}%;top:${o.y}%;${o.type==='decoy'?`font-size:${o.size}px;transform:translate(-50%,-50%) rotate(${o.rotate}deg);`:''}" data-hidden-object="${escapeHtml(o.id)}" aria-label="${o.type==='decoy'?'garden decoration':o.type==='target'?escapeHtml(o.label):'final evidence'}">${escapeHtml(o.symbol)}</button>`).join('');
  const howMany=state.hiddenFound.length;
  $('#puzzleBody').innerHTML=`${puzzleHeader('A little search in the garden',p.instructions,'hidden')}<div class="puzzle-help">Find the tiny teacup, brass key and ball of yarn. There are plenty of look-alikes. When all three are found, the last piece of evidence will appear.</div><div class="garden-scene"><span class="garden-sun">☼</span><span class="garden-tree">🌳</span><span class="garden-tree-two">🌳</span><span class="garden-path"></span>${garden}</div><div class="puzzle-controls" style="justify-content:center"><button class="small-button" data-action="hidden-hint">💡 Hint for the next object</button></div><p class="garden-hint" id="hiddenHintText">${howMany} of 3 garden objects found.${state.hiddenWeaponFound?' Final evidence collected.':''}</p><p class="status-message ${state.completed.hidden?'good':''}">${state.completed.hidden?'Weapon clue collected: '+escapeHtml(state.clues.hidden):'Look carefully around the cottage, trees and pond.'}</p>`;
  $('#puzzleBody').onclick=handleHiddenClick;
}
async function handleHiddenClick(event){
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='hidden-hint'){
    const hints=state.booklet.puzzles.hidden.hints||[];const next=state.booklet.puzzles.hidden.targets.find(t=>!state.hiddenFound.includes(t.id));
    $('#hiddenHintText').textContent=state.hiddenFound.length===3?'The final evidence is waiting among the garden details.':(hints[state.hiddenHintIndex%Math.max(1,hints.length)]||next?.hint||'Look near the cottage.');state.hiddenHintIndex++;return;
  }
  const object=event.target.closest('[data-hidden-object]');if(!object||state.completed.hidden)return;
  const id=object.dataset.hiddenObject;const p=state.booklet.puzzles.hidden;
  if(id.startsWith('decoy-')){toast('Not quite — keep looking.');return;}
  if(id==='weapon'){
    state.hiddenWeaponFound=true;renderHidden();await completePuzzle('hidden',{foundIds:state.hiddenFound,weaponFound:true});return;
  }
  if(!state.hiddenFound.includes(id)){state.hiddenFound.push(id);toast(`${p.targets.find(t=>t.id===id)?.label||'Object'} found!`);renderHidden();}
}
function renderAccusation(){
  const all=VALID_PUZZLE_KEYS.every(k=>state.completed[k]);
  if(state.solved){
    $('#puzzleBody').innerHTML=`${puzzleHeader('Case closed', 'You followed every clue and found the truth. Put the kettle on; the story is yours.','accuse')}<div class="story-reveal"><p class="eyebrow">THE FULL STORY</p><h3>${escapeHtml(state.booklet.title)}</h3><p>${escapeHtml(state.story)}</p>${state.booklet.youtubeUrl?`<a href="${escapeHtml(state.booklet.youtubeUrl)}" target="_blank" rel="noopener">▶ Watch the solution video ↗</a>`:''}</div><div class="puzzle-controls" style="justify-content:center"><button class="button button-primary" data-action="close-case">Back to my room ↗</button></div>`;
    $('#puzzleBody').onclick=e=>{if(e.target.closest('[data-action="close-case"]'))closeBooklet();};return;
  }
  if(!all){
    $('#puzzleBody').innerHTML=`${puzzleHeader('The final deduction', 'Collect all five clues before making your accusation. Every chapter has a piece of the truth.','accuse')}<div class="puzzle-help">Your case file is not complete yet. Return to the puzzle chapters and collect the remaining clues.</div><div class="puzzle-controls">${PUZZLES.filter(x=>x[0]!=='accuse').map(x=>`<button class="small-button" data-jump="${x[0]}">${x[2]} ${state.completed[x[0]]?'✓':'·'}</button>`).join('')}</div><p class="status-message">${Object.keys(state.completed).filter(k=>VALID_PUZZLE_KEYS.includes(k)).length} of 5 clues collected.</p>`;
    $('#puzzleBody').onclick=e=>{const jump=e.target.closest('[data-jump]');if(jump){state.currentPuzzle=jump.dataset.jump;renderTabs();renderPuzzle();}};return;
  }
  $('#puzzleBody').innerHTML=`${puzzleHeader('Who did it?', 'Take one last look at the clue board. Choose the person, motive, room and weapon that fit all the evidence.','accuse')}<div class="accusation-grid"><label>Killer<select id="accuseKiller"><option value="">Choose a suspect</option>${SUSPECTS.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Motive<select id="accuseMotive"><option value="">Choose a motive</option>${MOTIVES.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Location<select id="accuseLocation"><option value="">Choose a room</option>${LOCATIONS.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Weapon<select id="accuseWeapon"><option value="">Choose the evidence</option>${WEAPONS.map(x=>`<option>${x}</option>`).join('')}</select></label></div><div class="puzzle-controls" style="justify-content:center"><button class="button button-primary" data-action="accuse">Make my accusation ↗</button></div><p class="status-message"></p>`;
  $('#puzzleBody').onclick=async e=>{if(e.target.closest('[data-action="accuse"]'))await makeAccusation();};
}
const VALID_PUZZLE_KEYS=['wordsearch','sudoku','number','murdoku','hidden'];
async function completePuzzle(key,submission){
  if(state.completed[key])return;
  const path=state.preview?`/api/admin/booklets/${state.booklet.id}/check/${key}`:`/api/booklets/${state.booklet.id}/check/${key}`;
  try{
    const result=await api(path,{method:'POST',body:submission});
    updateClueState(key,result.clue);
    if(result.user){state.user=result.user;updateAccount();}
    if(result.reward)toast(`${result.message} +${result.reward} coins.`);
    else toast('Correct! A new clue is in your case file.');
    renderPuzzle();
  }catch(error){setMessage(error.message);}
}
async function makeAccusation(){
  const answer={killer:$('#accuseKiller').value,motive:$('#accuseMotive').value,location:$('#accuseLocation').value,weapon:$('#accuseWeapon').value};
  const path=state.preview?`/api/admin/booklets/${state.booklet.id}/accuse`:`/api/booklets/${state.booklet.id}/accuse`;
  try{
    const result=await api(path,{method:'POST',body:answer});
    state.solved=true;state.story=result.story;state.user=result.user||state.user;if(state.user)updateAccount();
    $('#storyRow').hidden=false;$('#lastStoryTitle').textContent=state.booklet.title;renderPuzzle();renderRoom();toast(state.preview?'Preview accusation correct.':'Case closed! You earned '+result.reward+' coins.');
  }catch(error){setMessage(error.message);}
}
async function loadShop(){
  if(!state.user){state.shopItems=[];state.inventory=[];renderShop();return;}
  try{const data=await api('/api/shop');state.shopItems=data.items;state.user=data.user;state.inventory=data.user.inventory||[];state.roomLayout=data.user.roomLayout||{};updateAccount();renderShop();renderDecor();}
  catch(error){console.error(error);}
}
function owns(itemId){return state.inventory.some(i=>i.item_id===itemId&&i.quantity>0);}
function renderShop(){
  const root=$('#shopItems'),collection=$('#collectionItems');
  if(!state.user){root.innerHTML='<div class="empty-state">Sign in to buy decorations with your puzzle coins.</div>';collection.innerHTML='<div class="empty-state">Sign in to save your room collection.</div>';return;}
  root.innerHTML=state.shopItems.map(item=>`<div class="shop-item"><span class="item-icon">${item.icon}</span><div class="item-info"><b>${escapeHtml(item.name)}</b><small>🪙 ${item.cost} coins</small></div><button data-buy="${item.id}" ${owns(item.id)?'disabled':''}>${owns(item.id)?'Owned':'Buy'}</button></div>`).join('');
  collection.innerHTML=state.inventory.length?state.inventory.map(inv=>{const item=state.shopItems.find(x=>x.id===inv.item_id);if(!item)return '';const selected=state.selectedItemId===item.id;const slot=Object.keys(state.roomLayout).find(k=>state.roomLayout[k]===item.id);return `<div class="collection-item ${selected?'selected':''}"><span class="item-icon">${item.icon}</span><div class="item-info"><b>${escapeHtml(item.name)}</b><small>${slot?`Placed: ${slot}`:'Not placed yet'}</small></div><button data-select-item="${item.id}">${selected?'Selected':'Place'}</button></div>`;}).join(''):'<div class="empty-state">Solve a mystery to earn coins and collect your first decoration.</div>';
  root.onclick=async e=>{const button=e.target.closest('[data-buy]');if(!button)return;try{const data=await api('/api/shop/buy',{method:'POST',body:{itemId:button.dataset.buy}});state.user=data.user;state.inventory=data.user.inventory||[];state.roomLayout=data.user.roomLayout||{};updateAccount();renderShop();renderDecor();toast(data.message);}catch(error){toast(error.message);}};
  collection.onclick=e=>{const button=e.target.closest('[data-select-item]');if(!button)return;state.selectedItemId=state.selectedItemId===button.dataset.selectItem?null:button.dataset.selectItem;renderShop();renderDecor();$('#placementHint').textContent=state.selectedItemId?'Now tap a dotted spot in your room to place it.':'Choose an item to decorate your room.';};
}
async function placeDecoration(slot){
  if(!state.selectedItemId)return;
  state.roomLayout[slot]=state.selectedItemId;
  try{const data=await api('/api/room/layout',{method:'PUT',body:{layout:state.roomLayout}});state.user=data.user;state.roomLayout=data.user.roomLayout;state.selectedItemId=null;renderShop();renderDecor();$('#placementHint').textContent='Your room has been updated. Lovely choice.';toast('Your room feels a little more like yours.');}
  catch(error){toast(error.message);}
}
function renderDecor(){
  const stage=$('#roomStage');
  $$('.decor-slot',stage).forEach(el=>{const slot=el.dataset.slot;const itemId=state.roomLayout[slot];const item=state.shopItems.find(x=>x.id===itemId);el.innerHTML=item?item.icon:'';el.classList.toggle('placed',!!item);el.classList.toggle('placement-target',!!state.selectedItemId);el.title=state.selectedItemId?`Place in ${slot}`:(item?item.name:slot);el.onclick=()=>placeDecoration(slot);});
}
function renderRoom(){
  $('#roomCoins').textContent=state.user?.coins??0;updateRoomCaseCard();
  if(state.solved){$('#storyRow').hidden=false;$('#lastStoryTitle').textContent=state.booklet?.title||'A story well solved.';}else $('#storyRow').hidden=true;
  renderShop();renderDecor();
}
function wireStatic(){
  $$('[data-page]').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));
  $('#startJourneyButton').onclick=()=>{if(state.user)showPage('room');else{state.pendingOpen=true;openAuth('register');}};
  $('#startJourneyButton2').onclick=()=>{if(state.user)showPage('room');else{state.pendingOpen=true;openAuth('register');}};
  $('#openBookletButton').onclick=()=>openBooklet();$('#roomCaseOpen').onclick=()=>openBooklet();
  $('#closeBookletButton').onclick=closeBooklet;
  $('#rulesStartButton').onclick=()=>{if(state.user){showPage('room');openBooklet();}else{state.pendingOpen=true;openAuth('register');}};
  $('#authClose').onclick=closeAuth;$('#authForm').addEventListener('submit',authSubmit);
  $$('.auth-switch button').forEach(btn=>btn.onclick=()=>openAuth(btn.dataset.authMode));
  $('#readStoryButton').onclick=()=>{if(state.booklet){state.currentPuzzle='accuse';$('#bookletOverlay').hidden=false;renderTabs();renderPuzzle();}};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#bookletOverlay').hidden)closeBooklet();if(!$('#authModal').hidden)closeAuth();}});
}
async function init(){
  wireStatic();setCountdown();setInterval(setCountdown,1000);
  const params=new URLSearchParams(location.search);const preview=params.get('preview');
  try{const auth=await api('/api/auth/me');state.user=auth.user;updateAccount();}catch{}
  if(preview){await loadPreview(preview);return;}
  await loadPublicBooklet();
  if(state.user){await loadProgress();await loadShop();}
  updateAccount();
}
init();
