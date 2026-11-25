'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const engine = require('../puzzle-engine');
const { callOllama } = require('../lib/ollama');

async function main() {
  let checked = 0;
  for (let i = 0; i < 60; i++) {
    const date = `2026-12-${String((i % 28) + 1).padStart(2,'0')}`;
    const booklet = engine.generateBooklet(date, `smoke-${i}`);
    assert.deepEqual(engine.validateBooklet(booklet), [], `built-in booklet ${i} failed validation`);
    assert.equal(engine.countSudokuSolutions(booklet.puzzles.sudoku.givens, 2), 1, 'Sudoku must have exactly one solution');
    const places = Object.values(booklet.puzzles.murdoku.solution);
    assert.equal(new Set(places.map(n => Math.floor(n / 5))).size, 5, 'Murdoku must use every row once');
    assert.equal(new Set(places.map(n => n % 5)).size, 5, 'Murdoku must use every column once');
    assert.equal(booklet.puzzles.hidden.weaponObject.label, booklet.mystery.weapon);
    assert.match(booklet.mystery.time, /^4:(4[2-9]|5[0-8]) PM$/, 'The number pattern must reveal the correct minutes for the 4 PM clock');
    checked++;
  }

  // Explicitly exercise every room code, including Cellar (B), which must not be confused with Conservatory (C).
  for (const [roomIndex, location] of engine.LOCATIONS.entries()) {
    for (let i = 0; i < 6; i++) {
      const mystery = {
        killer: engine.SUSPECTS[i % 4], victim: engine.VICTIM, motive: engine.MOTIVES[i % 5],
        location, weapon: engine.WEAPONS[i % 5], time: '4:47 PM', title: `Room check ${location}`
      };
      const booklet = engine.generateBooklet('2026-12-30', `room-${roomIndex}-${i}`, mystery);
      assert.deepEqual(engine.validateBooklet(booklet), [], `${location} Murdoku must pass validation`);
      const roomCode = engine.LOCATION_CODES[location];
      const occupants = Object.entries(booklet.puzzles.murdoku.solution).filter(([, cell]) =>
        booklet.puzzles.murdoku.rooms[Math.floor(cell / 5)][cell % 5] === roomCode
      ).map(([person]) => person);
      assert.deepEqual(new Set(occupants), new Set([mystery.killer, mystery.victim]), `${location} must contain only the killer and victim`);
      checked++;
    }
  }

  const brief = {
    title: 'The Bluebell Clock Mystery', killer: 'Miss Pip', victim: engine.VICTIM,
    motive: 'Stolen Recipe', location: 'Conservatory', weapon: 'Silver Candlestick',
    time: '4:47 PM', opening: 'Rain rested softly on the greenhouse panes.',
    story: 'Miss Pip had kept the honey-mint recipe close to her heart for years. When Lady Marigold announced a sale, a quiet argument began in the Conservatory. The old clock stopped at 4:47 PM. A silver candlestick had been carried from the mantel and hidden among the garden things. The guests each remembered a different sound, but the five puzzle chapters brought their accounts together. The word search pointed toward the recipe, the Sudoku named the room, the number pattern fixed the time, the Murdoku placed the guests and the garden search found the final evidence. Miss Pip had hoped the rain would wash away the last trace of her visit. It did not. By morning, the house was quiet again, and the kettle was warm.',
    wordSearchWords: ['HONEY','MINT','SUGAR','RECIPE','JAR'],
    instructions: { wordsearch:'Find the garden words.', sudoku:'Complete the grid.', number:'Find the next number.', murdoku:'Place each guest.', hidden:'Find the small garden objects.' },
    hints: { wordsearch:'Think of the tea table.', sudoku:'The golden square is useful.', number:'Look at the growing gaps.', hidden:['Near the pond.','By the roots.','Beside the door.'] }
  };
  const mock = http.createServer(async (req, res) => {
    let body=''; for await (const chunk of req) body += chunk;
    if (req.url === '/api/chat') {
      const data=JSON.parse(body);
      assert.ok(data.format && data.format.type==='object', 'Ollama call should use a JSON schema');
      assert.equal(data.think, false, 'Ollama should return only its final structured response');
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({model:'mock-local-model',message:{content:JSON.stringify(brief)}}));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => mock.listen(0,'127.0.0.1',resolve));
  try {
    const port=mock.address().port;
    const result=await callOllama({baseUrl:`http://127.0.0.1:${port}`,model:'mock-local-model',date:'2026-12-29',mystery:null,timeoutMs:5000});
    assert.equal(result.model,'mock-local-model');
    const m={killer:result.brief.killer,victim:result.brief.victim,motive:result.brief.motive,location:result.brief.location,weapon:result.brief.weapon,time:result.brief.time,title:result.brief.title};
    const aiBooklet=engine.generateBooklet('2026-12-29','mock-llm-seed',m,result.brief);
    aiBooklet.story=result.brief.story;
    aiBooklet.creative={opening:result.brief.opening,instructions:result.brief.instructions,hints:result.brief.hints,wordSearchWords:result.brief.wordSearchWords};
    assert.deepEqual(engine.validateBooklet(aiBooklet),[], 'LLM-authored case facts must produce a valid booklet');
    assert.deepEqual(aiBooklet.puzzles.wordsearch.words,result.brief.wordSearchWords);
    checked++;
  } finally { await new Promise(resolve=>mock.close(resolve)); }

  console.log(`✓ ${checked} booklet generation checks passed.`);
  console.log('✓ 6×6 Sudoku uniqueness, Murdoku row/column placement, hidden-object weapon mapping, and the local Ollama JSON-schema handshake passed.');
}
main().catch(error=>{console.error('Smoke test failed:',error);process.exit(1);});
