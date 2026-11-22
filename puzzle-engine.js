'use strict';

const SUSPECTS = ['Lady Ivy', 'Mr. Finch', 'Dr. Rose', 'Miss Pip', 'Professor Wren'];
const LOCATIONS = ['Kitchen', 'Library', 'Conservatory', 'Cellar'];
const MOTIVES = ['Stolen Recipe', 'Jealousy', 'Blackmail', 'Hidden Debt', 'Inheritance'];
const WEAPONS = ['Silver Candlestick', 'Garden Shears', 'Poisoned Scone', 'Antique Letter Opener', 'Heavy Brass Teapot'];
const VICTIM = 'Lady Marigold';
const ROOM_CODES = { Kitchen: [1, 2], Library: [3], Conservatory: [4, 5], Cellar: [6] };
const ROOM_MAP = [
  'KKLLL',
  'KKLLL',
  'KCCCB',
  'CCCBB',
  'CCBBB'
];
const ROOM_NAMES = { K: 'Kitchen', L: 'Library', C: 'Conservatory', B: 'Cellar' };
const LOCATION_CODES = { Kitchen: 'K', Library: 'L', Conservatory: 'C', Cellar: 'B' };
const BLOCKED = [3, 10, 17]; // 0-based: chairs/tables in the floor plan
const LANDMARKS = [
  { id: 'fern', symbol: '🪴', name: 'potted fern' },
  { id: 'chair', symbol: '🪑', name: 'velvet chair' },
  { id: 'clock', symbol: '🕰️', name: 'mantel clock' },
  { id: 'books', symbol: '📚', name: 'bookcase' },
  { id: 'mirror', symbol: '🪞', name: 'oval mirror' }
];

function hashSeed(value) {
  let h = 2166136261;
  for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = hashSeed(seed) || 1;
  return function random() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(items, random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(items, random) { return items[Math.floor(random() * items.length)]; }
function pad(n) { return String(n).padStart(2, '0'); }
function storyFor(m) {
  const motiveLines = {
    'Stolen Recipe': `${m.killer} had discovered that the old honey-mint recipe was about to be sold, and feared losing the only thing that made the family famous.`,
    'Jealousy': `${m.killer} could not bear watching ${m.victim} praise another guest, and the resentment had quietly grown for months.`,
    'Blackmail': `${m.killer} had been receiving anonymous notes. ${m.victim} had found the sender's identity and planned to reveal it that evening.`,
    'Hidden Debt': `${m.killer} owed a dangerous sum of money. ${m.victim} had found the unpaid ledger and refused to keep the secret any longer.`,
    'Inheritance': `${m.killer} believed the family estate would pass to someone else after ${m.victim} changed the will. That afternoon, a private argument became fatal.`
  };
  return `${m.title}\n\nThe rain had stopped just before the last guests arrived at ${m.victim}'s little gathering. The clocks in the old house were never quite in agreement, but the clues placed the moment of death at ${m.time}.\n\n${motiveLines[m.motive]} The confrontation took place in the ${m.location}. In the confusion, ${m.killer} used the ${m.weapon.toLowerCase()} and tried to leave it among the garden things.\n\nThe five puzzles told the story from different angles: a hidden phrase exposed the motive, the little number pattern fixed the time, the Sudoku pointed to the room, the Murdoku placed every guest on the floor plan, and the garden search uncovered the weapon. The one person whose path crossed the victim's in the right room was ${m.killer}.\n\nThe house grew quiet again. Someone put the kettle on, the rain began tapping at the windows, and the case was closed — until tomorrow's mystery.`;
}

function makeWordSearch(motive, random, customWords=null) {
  const wordSets = {
    'Stolen Recipe': ['RECIPE', 'HONEY', 'MINT', 'SUGAR', 'JAR'],
    'Jealousy': ['RIVAL', 'PRAISE', 'SECRET', 'GARDEN', 'GLANCE'],
    'Blackmail': ['LETTER', 'SECRET', 'MONEY', 'THREAT', 'NOTE'],
    'Hidden Debt': ['LEDGER', 'COINS', 'OWING', 'BANK', 'DEBT'],
    'Inheritance': ['WILL', 'ESTATE', 'HEIR', 'SEAL', 'FAMILY']
  };
  const safeCustom=Array.isArray(customWords) ? customWords.map(w=>String(w).toUpperCase().replace(/[^A-Z]/g,'')).filter(w=>w.length>=3&&w.length<=9).slice(0,5) : [];
  const words = safeCustom.length>=4 ? [...new Set(safeCustom)].slice(0,5) : (wordSets[motive] || wordSets['Stolen Recipe']);
  const size = 9;
  const dirs = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let attempt = 0; attempt < 100; attempt++) {
    const grid = Array.from({ length: size }, () => Array(size).fill(''));
    const placements = [];
    const ordered = words.slice().sort((a,b) => b.length-a.length);
    let failed = false;
    for (const word of ordered) {
      let placed = false;
      for (let tries = 0; tries < 500 && !placed; tries++) {
        const [dr,dc] = pick(dirs, random);
        const r = Math.floor(random()*size), c = Math.floor(random()*size);
        const er = r + dr*(word.length-1), ec = c + dc*(word.length-1);
        if (er<0 || er>=size || ec<0 || ec>=size) continue;
        let ok = true;
        for (let i=0;i<word.length;i++) {
          const old = grid[r+dr*i][c+dc*i];
          if (old && old !== word[i]) { ok=false; break; }
        }
        if (!ok) continue;
        const cells=[];
        for (let i=0;i<word.length;i++) { grid[r+dr*i][c+dc*i]=word[i]; cells.push((r+dr*i)*size+(c+dc*i)); }
        placements.push({ word, cells }); placed=true;
      }
      if (!placed) { failed=true; break; }
    }
    if (failed) continue;
    const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let r=0;r<size;r++) for (let c=0;c<size;c++) if (!grid[r][c]) grid[r][c]=letters[Math.floor(random()*letters.length)];
    return { size, grid: grid.flat(), words: words.slice(), placements };
  }
  throw new Error('Could not generate a word search.');
}

function countSudokuSolutions(grid, limit=2) {
  let count=0;
  const board=grid.slice();
  function candidates(i) {
    const r=Math.floor(i/6), c=i%6, used=new Set();
    for(let k=0;k<6;k++){used.add(board[r*6+k]);used.add(board[k*6+c]);}
    const br=Math.floor(r/2)*2,bc=Math.floor(c/3)*3;
    for(let rr=0;rr<2;rr++)for(let cc=0;cc<3;cc++)used.add(board[(br+rr)*6+bc+cc]);
    const out=[];for(let n=1;n<=6;n++)if(!used.has(n))out.push(n);return out;
  }
  function solve(){
    if(count>=limit)return;
    let best=-1,bestOpts=null;
    for(let i=0;i<36;i++)if(board[i]===0){const opts=candidates(i);if(!bestOpts||opts.length<bestOpts.length){best=i;bestOpts=opts;}if(opts.length===0)return;if(opts.length===1)break;}
    if(best===-1){count++;return;}
    for(const n of bestOpts){board[best]=n;solve();board[best]=0;if(count>=limit)return;}
  }
  solve();return count;
}
function makeSudoku(location, random) {
  const bands=shuffle([0,1,2],random), rows=[];
  for(const b of bands) for(const r of shuffle([0,1],random)) rows.push(b*2+r);
  const stacks=shuffle([0,1],random), cols=[];
  for(const s of stacks) for(const c of shuffle([0,1,2],random)) cols.push(s*3+c);
  const digits=shuffle([1,2,3,4,5,6],random);
  let solution=[];
  for(let r=0;r<6;r++) for(let c=0;c<6;c++) {
    const original=(rows[r]*3+Math.floor(rows[r]/2)+cols[c])%6;
    solution.push(digits[original]);
  }
  const keyIndex=14;
  const desired=pick(ROOM_CODES[location],random);
  const current=solution[keyIndex];
  const ci=digits.indexOf(current), di=digits.indexOf(desired);
  if(ci!==di){for(let i=0;i<36;i++){const v=solution[i];if(v===current)solution[i]=desired;else if(v===desired)solution[i]=current;}}
  const puzzle=solution.slice();
  const indices=shuffle(Array.from({length:36},(_,i)=>i),random);
  let removed=0;
  for(const i of indices){
    if(removed>=20)break;
    const old=puzzle[i];puzzle[i]=0;
    if(countSudokuSolutions(puzzle,2)===1)removed++;
    else puzzle[i]=old;
  }
  if(countSudokuSolutions(puzzle,2)!==1) throw new Error('Generated Sudoku is not unique.');
  return { size:6, boxRows:2, boxCols:3, givens:puzzle, solution, keyIndex, roomCode:desired };
}

function makeMurdoku(killer, location, random) {
  const people = SUSPECTS.slice(0,4).concat([VICTIM]);
  const target = LOCATION_CODES[location];
  if (!target) throw new Error(`Unknown Murdoku room: ${location}`);
  let chosen=null;
  for(let t=0;t<30000;t++){
    const rowCols=shuffle([0,1,2,3,4],random);
    const assigned=shuffle(people,random);
    const placements={};
    assigned.forEach((name,row)=>{placements[name]=row*5+rowCols[row];});
    const victimCell=placements[VICTIM], killerCell=placements[killer];
    const roomAt=(i)=>ROOM_MAP[Math.floor(i/5)][i%5];
    if (Object.values(placements).some(cell => BLOCKED.includes(cell))) continue;
    const occupantsInMurderRoom = people.filter(person => roomAt(placements[person]) === target);
    if (occupantsInMurderRoom.length !== 2 || !occupantsInMurderRoom.includes(killer) || !occupantsInMurderRoom.includes(VICTIM)) continue;
    const rows=new Set(Object.values(placements).map(i=>Math.floor(i/5)));
    const cols=new Set(Object.values(placements).map(i=>i%5));
    if(rows.size===5 && cols.size===5 && roomAt(victimCell)===target && roomAt(killerCell)===target){chosen=placements;break;}
  }
  if(!chosen) {
    // A fixed, valid arrangement for the Conservatory; other rooms are rare and handled by retrying room choice upstream.
    throw new Error('Could not create a valid Murdoku arrangement for this room.');
  }
  const landmarks=shuffle(LANDMARKS,random);
  const byPerson={};
  const furniture={};
  people.forEach((person,i)=>{
    byPerson[person]=landmarks[i];
    furniture[chosen[person]]={...landmarks[i]};
  });
  const clues=people.filter(p=>p!==VICTIM).map(p=>`${p} was beside the ${byPerson[p].name}.`);
  clues.push(`${VICTIM} and exactly one other guest were in the ${location}. That guest is responsible.`);
  return { size:5, people, victim:VICTIM, rooms:ROOM_MAP, roomNames:ROOM_NAMES, blocked:BLOCKED.slice(), furniture, clues, solution:chosen };
}

function makeNumber(time, random) {
  const minute=Number.parseInt(time.split(':')[1],10);
  const options=[];
  for(let a=1;a<=3;a++){const b=minute-36-6*a;if(b>=0&&b<=5)options.push({a,b});}
  const {a,b}=pick(options.length?options:[{a:1,b:2}],random);
  const sequence=[];for(let n=1;n<=5;n++)sequence.push(n*n+a*n+b);
  return { sequence, answer:36+6*a+b, hint:'Look at the gaps between the numbers. The gaps increase by 2 each time.', time };
}
function makeHidden(weapon, random) {
  const targets=[
    {id:'teacup',symbol:'☕',label:'tiny teacup',hint:'Look near the pond edge.'},
    {id:'key',symbol:'🗝️',label:'old brass key',hint:'Look around the tree roots.'},
    {id:'yarn',symbol:'🧶',label:'ball of yarn',hint:'Look by the cottage door.'}
  ];
  const points=[];
  const zones=[[56,85],[19,72],[82,58]];
  targets.forEach((t,i)=>{
    const [x,y]=zones[i];points.push({...t,x:x+(random()*4-2),y:y+(random()*4-2)});
  });
  const decoys=['🌼','🌸','🌿','🍄','🦋','🐝','🐞','🐦','🐇','🍎','🍂','🌻','🍃','🪨','🐌','🌷','🍵','🧵','🥣','🧤','🐿️','🪶','🪻','🪷'];
  const clutter=[];
  for(let i=0;i<55;i++) clutter.push({symbol:pick(decoys,random),x:5+random()*90,y:34+random()*60,size:11+random()*10,rotate:Math.round(random()*70-35)});
  const weaponSymbols = { 'Silver Candlestick':'🕯️', 'Garden Shears':'✂️', 'Poisoned Scone':'🧁', 'Antique Letter Opener':'✉️', 'Heavy Brass Teapot':'🫖' };
  const weaponObject = { id:'weapon', symbol:weaponSymbols[weapon] || '🔍', label:weapon, x:91, y:80, hint:'Look beside the cottage path.' };
  return { targets:points, weaponObject, clutter, revealedWeapon:weapon, scene:'garden' };
}

function makeMystery(date, random) {
  const killer=pick(SUSPECTS.slice(0,4),random);
  // The static floor plan supports all rooms, but retry the pair layout deterministically at the caller if needed.
  const location=pick(LOCATIONS,random);
  const motive=pick(MOTIVES,random);
  const weapon=pick(WEAPONS,random);
  const minute=42+Math.floor(random()*17);
  // The number-series chapter encodes the minutes; the clock face fixes the hour at 4 PM.
  const time=`4:${pad(minute)} PM`;
  return { killer, victim:VICTIM, motive, location, weapon, time, title:`The ${pick(['Midnight','Rainy','Forgotten','Velvet','Last'],random)} ${pick(['Tea Party','Conservatory Affair','Cottage Case','Clockwork Mystery','Garden Secret'],random)}` };
}

function generateBooklet(date, seedValue=date, mysteryOverride=null, aiBrief=null) {
  const random=rng(seedValue);
  let mystery=null, puzzles=null;
  // The LLM may propose the case facts; the deterministic engine builds and verifies the puzzle mechanics.
  for(let attempt=0;attempt<100;attempt++){
    mystery=mysteryOverride ? { ...mysteryOverride } : makeMystery(date,random);
    try {
      const murdoku=makeMurdoku(mystery.killer,mystery.location,rng(`${seedValue}:murdoku:${attempt}`));
      puzzles={
        wordsearch:makeWordSearch(mystery.motive,rng(`${seedValue}:word`),aiBrief?.wordSearchWords),
        sudoku:makeSudoku(mystery.location,rng(`${seedValue}:sudoku`)),
        number:makeNumber(mystery.time,rng(`${seedValue}:number`)),
        murdoku,
        hidden:makeHidden(mystery.weapon,rng(`${seedValue}:hidden`))
      };
      break;
    } catch (err) {
      if(attempt===99) throw err;
    }
  }
  const story=(aiBrief && typeof aiBrief.story==='string' && aiBrief.story.trim()) ? aiBrief.story.trim() : storyFor(mystery);
  const creative = aiBrief ? {
    opening: aiBrief.opening || '',
    instructions: aiBrief.instructions || {},
    hints: aiBrief.hints || {},
    instructions: aiBrief.instructions || {},
    wordSearchWords: aiBrief.wordSearchWords || null,
    tone: aiBrief.tone || 'cozy mystery'
  } : null;
  return { date, title:mystery.title, mystery, puzzles, story, creative, createdAt:new Date().toISOString() };
}

function regeneratePuzzle(booklet, key, seed) {
  const m=booklet.mystery;
  switch(key){
    case 'wordsearch': return makeWordSearch(m.motive,rng(`${seed}:word:${Date.now()}`));
    case 'sudoku': return makeSudoku(m.location,rng(`${seed}:sudoku:${Date.now()}`));
    case 'number': return makeNumber(m.time,rng(`${seed}:number:${Date.now()}`));
    case 'murdoku': return makeMurdoku(m.killer,m.location,rng(`${seed}:murdoku:${Date.now()}`));
    case 'hidden': return makeHidden(m.weapon,rng(`${seed}:hidden:${Date.now()}`));
    default: throw new Error('Unknown puzzle type.');
  }
}

function validateBooklet(booklet) {
  const errors=[];
  if(!booklet?.mystery || !booklet?.puzzles) return ['Booklet is missing required sections.'];
  const m=booklet.mystery,p=booklet.puzzles;
  if(!SUSPECTS.slice(0,4).includes(m.killer)) errors.push('Killer is not a valid suspect.');
  if(!LOCATIONS.includes(m.location)) errors.push('Location is invalid.');
  if(!MOTIVES.includes(m.motive)) errors.push('Motive is invalid.');
  if(!WEAPONS.includes(m.weapon)) errors.push('Weapon is invalid.');
  if(!p.wordsearch || !p.wordsearch.grid || p.wordsearch.grid.length!==81 || !p.wordsearch.words?.length) errors.push('Word search is incomplete.');
  if(!p.sudoku || p.sudoku.givens?.length!==36 || p.sudoku.keyIndex==null || countSudokuSolutions(p.sudoku.givens,2)!==1) errors.push('Sudoku is not a unique 6×6 puzzle.');
  if(p.sudoku && p.sudoku.solution?.[p.sudoku.keyIndex]!==p.sudoku.roomCode) errors.push('Sudoku golden square does not encode its location.');
  if(!p.number || p.number.sequence?.length!==5 || p.number.answer!==Number.parseInt(p.number.time?.split(':')[1],10) || !/^4:(4[2-9]|5[0-8]) PM$/.test(m.time) || p.number.time!==m.time) errors.push('Number pattern does not match the 4:__ PM time clue.');
  if(!p.murdoku || !p.murdoku.furniture || !p.murdoku.clues?.length || !p.murdoku.solution) errors.push('Murdoku is incomplete.');
  if(!p.hidden || p.hidden.targets?.length!==3 || !p.hidden.weaponObject) errors.push('Hidden-object scene is incomplete.');
  if(p.wordsearch?.placements && p.wordsearch.placements.some(x => !x.cells || x.cells.length !== x.word.length || x.cells.some(i => p.wordsearch.grid[i] !== x.word[x.cells.indexOf(i)]))) errors.push('Word-search placements are inconsistent.');
  if(p.murdoku?.solution) {
    const cells=Object.values(p.murdoku.solution);
    if(cells.length!==5 || new Set(cells).size!==5 || new Set(cells.map(i=>Math.floor(i/5))).size!==5 || new Set(cells.map(i=>i%5)).size!==5 || cells.some(i=>p.murdoku.blocked.includes(i))) errors.push('Murdoku placement rules are invalid.');
    const roomAt=i=>p.murdoku.rooms[Math.floor(i/5)][i%5];
    const murderRoomOccupants=Object.entries(p.murdoku.solution).filter(([,cell])=>roomAt(cell)===LOCATION_CODES[m.location]).map(([person])=>person);
    if(roomAt(p.murdoku.solution[m.killer])!==LOCATION_CODES[m.location] || roomAt(p.murdoku.solution[m.victim])!==LOCATION_CODES[m.location] || murderRoomOccupants.length!==2 || !murderRoomOccupants.includes(m.killer) || !murderRoomOccupants.includes(m.victim)) errors.push('Murdoku must place only the killer and victim together in the murder room.');
  }
  if(p.hidden?.revealedWeapon!==m.weapon) errors.push('Hidden-object reward does not match the murder weapon.');
  return errors;
}

module.exports = { generateBooklet, regeneratePuzzle, validateBooklet, countSudokuSolutions, SUSPECTS, LOCATIONS, MOTIVES, WEAPONS, VICTIM, ROOM_CODES, ROOM_MAP, ROOM_NAMES, LOCATION_CODES, BLOCKED };
