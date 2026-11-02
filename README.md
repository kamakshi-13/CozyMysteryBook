# CozyMysteryBook
A cozy daily murder-mystery puzzle book. Players solve five puzzle chapters, identify the killer, motive, location and weapon, unlock a short story, earn coins, and decorate a personal reading room. A private Keeper dashboard creates and checks the next day's booklet before it can be published.

This local build uses no cloud database, hosted AI API, Firebase, Supabase or other backend service. The website, server, authentication, SQLite database, puzzle engine and scheduler all run on your computer. The optional LLM runs locally through Ollama.
1. What is included
- Public welcome page, puzzle rules and cozy reading-room interface.
- User registration and sign-in, using locally stored password hashes and sessions.
- Daily booklet with five playable sections:
  1. Word search — the motive.
  2. 6×6 Sudoku — the location (golden-square room code), with pencil notes, Undo and Reset.
  3. Number pattern — the time.
  4. 5×5 Murdoku — the killer, with placement notes, row/column exclusions, Undo and Reset.
  5. Hidden objects — three garden objects, followed by the weapon evidence.
- Server-side answer checking and a final accusation form.
- A short story revealed only after a correct accusation.
- Coins for puzzle completion and case closure, a decoration shop, owned-item collection and saved room layout.
- A private Keeper dashboard at /admin/lantern-room. It can generate a draft, show the answer key and full story, open a playable preview, regenerate one puzzle, save a YouTube URL and approve publication.
- Local scheduler: generate tomorrow's booklet at 6:00 PM and publish an approved booklet at 12:00 AM, using Asia/Kolkata.
- An optional built-in deterministic sample generator, selectable by unticking the local LLM option.
2. Requirements
- Node.js 22.13 or newer. This project uses Node's built-in SQLite module (node:sqlite), so no database package is needed.
- Ollama is optional for the website itself, but required for local LLM-generated case themes and stories.
- Windows, macOS or Linux.
Check Node from PowerShell or Terminal:
node --version
3. Install the local LLM (Ollama)
1. Install Ollama from ollama.com/download.
2. Open PowerShell or Terminal and download a local model:
ollama pull qwen3:4b
3. Keep Ollama running. If it is not already running in the background, start it with:
ollama serve
The default model is qwen3:4b. You can choose another model available in your local Ollama installation from the Keeper dashboard. qwen3:8b is a larger option for a computer with more memory. Model downloads take disk space and the first generation can take longer while the model loads.

Ollama's local chat API is used at http://127.0.0.1:11434/api/chat. The request uses a JSON Schema response format so the app can parse a structured case brief. See the Ollama structured outputs documentation.
4. Configure the Keeper account (important)
Before the first run, copy .env.example to .env.

Windows PowerShell:
Copy-Item .env.example .env
notepad .env
Change these values before launching the app for the first time:
ADMIN_USERNAME=keeper
ADMIN_PASSWORD=ChooseYourOwnStrongPassword123!
ADMIN_PATH=/admin/lantern-room
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
TIMEZONE=Asia/Kolkata
PORT=3000
The first time the app starts, it creates the Keeper account in the local database. Changing the .env admin password after that does not overwrite the existing account password. To reset the local app completely, stop the server and delete data/cozymystrybook.sqlite (this also deletes all local users, booklets, coins and room arrangements).

The default example credentials, if you did not customise .env before the first launch, are:
- Username: keeper
- Password: ChangeThisPassword123!
Change these before using the app with real personal data.
5. Run the website
Windows shortcut: double-click run-windows.bat. On its first run it creates .env from .env.example and opens Notepad so you can set your Keeper password.

Or open PowerShell or Terminal inside this project folder and run:
npm start
No npm install is required: the project has no npm dependencies.

Open the public website:
http://localhost:3000
Open the private Keeper dashboard (do not add this link to the public navigation):
http://localhost:3000/admin/lantern-room
Sign in with the Keeper credentials you configured in .env.
6. Daily booklet workflow
1. At 6:00 PM, the local scheduler asks Ollama to invent a fresh case and editorial content for the next date.
2. The puzzle engine constructs the grids and solution keys. It checks the 6×6 Sudoku has exactly one solution, checks Murdoku row/column placement and confirms the puzzle clues align with the selected case facts.
3. The booklet is saved as a Draft. It is not public.
4. In the Keeper dashboard, open it and inspect the answer key and complete story.
5. Select Play-test this booklet to open the same interactive puzzle experience that players will see.
6. Use an individual Regenerate this puzzle button to replace one puzzle without changing the case facts. Regenerating puts the booklet back into Draft status, so approve it again after testing.
7. Add the YouTube solution URL and select Approve for midnight.
8. At 12:00 AM on the booklet's scheduled date, the scheduler changes an approved booklet to Published. The public site only serves the booklet for the current local date.
For testing, the Keeper dashboard also has Publish now (testing). This deliberately bypasses the midnight wait and is intended for local testing only.
7. What the local LLM does
The local model selects the killer, motive, location, weapon and time, writes the case title and reveal story, and creates the themed word-search vocabulary, puzzle instructions and hints. The model does not get trusted to invent unchecked answer keys. The code constructs the playable Sudoku, Murdoku, number sequence, word-search grid and hidden-object scene around those case facts, then validates the solutions and cross-puzzle consistency before the booklet can be approved. This hybrid approach uses the LLM for creative daily content and deterministic code for puzzle correctness.

This hybrid design is deliberate: language models can produce inconsistent logic. The code owns the answer keys and puzzle rules; the Keeper owns final editorial approval.

When Use my local Ollama model is checked, Ollama must be running and the selected model must be downloaded. If it is unavailable, generation stops and shows an error; it will not silently substitute non-AI content. Untick that option only when you deliberately want a built-in sample booklet without using an LLM.
8. Local data and backups
All persistent app data is stored in:
data/cozymystrybook.sqlite
This includes local accounts, password hashes, active sessions, daily booklets, progress, coins, purchases and room layouts. To back it up, stop the server and copy the SQLite file to a safe folder. Do not delete it unless you intend to reset the app.
9. Important local scheduling notes
The 6:00 PM and midnight jobs only run while node server.js / npm start is running. Ollama must also be available when the 6:00 PM generation happens. Keep the computer awake and connected to power if you expect the daily jobs to run automatically. If the computer is off at midnight, the job cannot execute at that moment. When you start the app later that same day, it checks for an already-approved booklet for that date and publishes it late rather than exposing it early. A booklet that was not approved before midnight remains a draft and needs your manual decision.

The scheduler uses Asia/Kolkata. If you change the timezone in .env, restart the app.
10. Run the built-in checks
npm run check
The checks generate many sample booklets and validate Sudoku uniqueness, Murdoku constraints, hidden-object weapon mapping and the local Ollama structured-response integration using a local mock endpoint.
11. Project structure
cozymystrybook/
├── server.js                 # Local HTTP server, API routes and scheduler
├── puzzle-engine.js          # Puzzle construction, answer keys and validation
├── lib/
│   ├── database.js           # Local SQLite, sessions and password hashing
│   └── ollama.js             # Local Ollama connection and JSON-schema prompt
├── public/
│   ├── index.html            # Public site
│   ├── styles.css            # Public site and room styling
│   ├── app.js                # Player experience and puzzle interactions
│   ├── admin.html            # Keeper dashboard (unlinked private path)
│   ├── admin.css             # Dashboard styling
│   └── admin.js              # Dashboard interactions
├── scripts/
│   └── smoke-test.js         # Built-in logic and local LLM integration checks
├── data/                     # Created automatically; local SQLite database
├── .env.example              # Local configuration template
├── run-windows.bat           # Windows double-click starter
└── README.md
Privacy note: This setup is intended for local development on your own computer. The unlinked Keeper URL is not a substitute for a strong password. The default bind address is 127.0.0.1, so the server is only reachable from this computer. For a future Render deployment, the host binding will need to change to 0.0.0.0 and the app will need a persistent database/storage plan.
