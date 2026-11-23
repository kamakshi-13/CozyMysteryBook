'use strict';
const { SUSPECTS, LOCATIONS, MOTIVES, WEAPONS, VICTIM } = require('../puzzle-engine');

const schema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    killer: { type: 'string', enum: SUSPECTS.slice(0, 4) },
    victim: { type: 'string', enum: [VICTIM] },
    motive: { type: 'string', enum: MOTIVES },
    location: { type: 'string', enum: LOCATIONS },
    weapon: { type: 'string', enum: WEAPONS },
    time: { type: 'string' },
    opening: { type: 'string' },
    story: { type: 'string' },
    wordSearchWords: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 5 },
    instructions: {
      type: 'object',
      properties: {
        wordsearch: { type: 'string' },
        sudoku: { type: 'string' },
        number: { type: 'string' },
        murdoku: { type: 'string' },
        hidden: { type: 'string' }
      },
      required: ['wordsearch','sudoku','number','murdoku','hidden']
    },
    hints: {
      type: 'object',
      properties: {
        wordsearch: { type: 'string' },
        sudoku: { type: 'string' },
        number: { type: 'string' },
        hidden: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 }
      },
      required: ['wordsearch','sudoku','number','hidden']
    }
  },
  required: ['title','killer','victim','motive','location','weapon','time','opening','story','wordSearchWords','instructions','hints']
};

function validTime(value) {
  return typeof value === 'string' && /^(1[0-2]|0?[1-9]):[0-5][0-9]\s?(AM|PM)$/i.test(value.trim());
}
function cleanWords(words, motive) {
  const cleaned = Array.isArray(words) ? words.map(w => String(w).toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length >= 3 && w.length <= 9) : [];
  return [...new Set(cleaned)].length >= 4 ? [...new Set(cleaned)].slice(0,5) : null;
}
function normalizeBrief(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Ollama returned an empty response.');
  const brief = { ...raw };
  if (!SUSPECTS.slice(0,4).includes(brief.killer)) throw new Error('The local model returned an unknown killer.');
  if (brief.victim !== VICTIM || !MOTIVES.includes(brief.motive) || !LOCATIONS.includes(brief.location) || !WEAPONS.includes(brief.weapon)) {
    throw new Error('The local model returned invalid case facts.');
  }
  if (!validTime(brief.time)) throw new Error('The local model returned an invalid time.');
  brief.time = brief.time.trim().replace(/\s+/g, ' ').toUpperCase();
  const hour = Number(brief.time.match(/^(\d{1,2}):/)[1]);
  const minute = Number(brief.time.match(/:(\d{2})/)[1]);
  if (hour !== 4 || minute < 42 || minute > 58) throw new Error('The local model time must be between 4:42 PM and 4:58 PM so the number-pattern encoding remains valid.');
  if (brief.story.trim().length < 350) throw new Error('The local model story is too short; generate a fuller reveal.');
  brief.title = String(brief.title || 'A little cozymystrybook mystery').slice(0, 90);
  brief.opening = String(brief.opening || '').slice(0, 500);
  brief.story = String(brief.story || '').slice(0, 5000);
  brief.wordSearchWords = cleanWords(brief.wordSearchWords, brief.motive);
  brief.instructions = brief.instructions || {};
  brief.hints = brief.hints || {};
  if (!Array.isArray(brief.hints.hidden) || brief.hints.hidden.length < 3) brief.hints.hidden = [];
  return brief;
}

async function callOllama({ baseUrl, model, mystery = null, date, timeoutMs = 180000 }) {
  const factsInstruction = mystery
    ? `Use these case facts exactly; do not change or contradict them:\n${JSON.stringify(mystery, null, 2)}`
    : `Invent the case facts yourself, selecting exactly one killer from ${JSON.stringify(SUSPECTS.slice(0,4))}, the victim ${VICTIM}, one motive from ${JSON.stringify(MOTIVES)}, one location from ${JSON.stringify(LOCATIONS)}, one weapon from ${JSON.stringify(WEAPONS)}, and a plausible time between 4:42 PM and 4:58 PM (the hour is fixed at 4 PM; the number puzzle reveals the minutes). The puzzle engine will validate and build every puzzle around those facts.`;
  const prompt = `You are the story editor and puzzle-booklet designer for cozymystrybook, a gentle cottagecore whodunit. Create a fresh, internally consistent daily booklet for ${date}.

The deterministic puzzle engine will enforce all puzzle mechanics and answer keys. ${factsInstruction}

Return JSON matching the supplied schema. Requirements:
- Give the case a charming, original cozy-mystery title and a short atmospheric opening.
- Write a satisfying 140-220 word reveal story. The named killer, motive, location, weapon, victim and time must match the facts exactly. Do not introduce a second killer or a contradictory weapon/location.
- Supply 4-5 distinct uppercase word-search words related to the motive/theme. Each must be 3-9 letters, no spaces, and not simply reveal the killer or weapon. The engine will place them into a solvable grid.
- Write player-friendly instructions for all five puzzle sections: wordsearch, sudoku, number, murdoku and hidden. Do not reveal answers in the instructions.
- Hints should nudge without giving away answers. Give exactly three hidden-object hints, one for each garden object.
- Keep the mood cozy, literary, clever and non-graphic. No gore, no explicit violence.
- The number sequence encodes the time, the Sudoku golden cell encodes the location, the Murdoku floor plan establishes the killer, the word search supports the motive, and the hidden-object scene confirms the weapon.
- Do not invent new puzzle mechanics; explain the familiar rules clearly.
`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Return only valid JSON that follows the given JSON schema. Preserve every supplied case fact exactly.' },
          { role: 'user', content: prompt }
        ],
        format: schema,
        think: false,
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0.75, num_predict: 2600 }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const parsed = JSON.parse(data.message?.content || '{}');
    const brief = normalizeBrief(parsed);
    return { brief, model: data.model || model };
  } finally { clearTimeout(timeout); }
}

async function getOllamaStatus(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const data = await response.json();
    return { online: true, models: (data.models || []).map(m => m.name), version: data.version || null };
  } catch (error) {
    return { online: false, models: [], error: error.message };
  }
}

module.exports = { callOllama, getOllamaStatus };
