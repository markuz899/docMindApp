# DocMind

**Ask your project's documentation. Everything stays local.**

DocMind is a desktop app that indexes a folder of technical documentation,
retrieves only the sections that actually answer your question, and hands
those sections to a small language model running on your own machine.

Nothing is trained, nothing is embedded in a cloud service, nothing leaves the
laptop. Documentation is retrieved *dynamically* at question time.

```
DOCUMENTATION FOLDER → PARSER → SECTIONS → SQLITE FTS5
                                                ↓
        ANSWER + SOURCES ← SMALL LOCAL LLM ← CONTEXT BUILDER
                                                ↑
                      TOP SECTIONS ← RANKING ← SEARCH ← QUERY ANALYSIS ← USER QUERY
```

---

## Requirements

- **Node.js 20 or newer** (22 recommended — the build is verified on 22.19).
- macOS, Linux or Windows.
- Optionally a local model:
  - a **`.gguf`** file, run through `llama.cpp` (`node-llama-cpp`), or
  - a running **[Ollama](https://ollama.com)** daemon.

DocMind is fully usable without a model: retrieval, indexing and the retrieval
graph all work, and answers are replaced by the ranked list of matching
sections.

## Install

```bash
cd docmind
npm install
```

`npm install` does not build the native modules by itself. Every script that
needs them calls `scripts/native.mjs` first, which swaps the `better-sqlite3`
binary between the **Node ABI** (for `vitest`) and the **Electron ABI** (for
the app). If you ever hit `NODE_MODULE_VERSION` errors, run:

```bash
npm run native:node       # before running tests directly
npm run native:electron   # before running the app directly
```

## Development

```bash
npm run dev            # Electron + Vite with HMR
npm run seed:demo      # index demo/example-project into data/docmind.db
npm run seed:demo -- ollama qwen3.5:2b     # …and preselect an Ollama model
npm run seed:demo -- gguf /path/model.gguf # …or a GGUF file
```

## Quality gates

```bash
npm run lint        # ESLint, no `any` allowed
npm run typecheck   # tsc --strict over main, preload, renderer and tests
npm test            # Vitest (parser, indexer, FTS, ranking, context, DB, LLM)
npm run build       # typecheck + production bundles into out/
```

The end-to-end test against a **real** local model is opt-in, because it needs
a daemon or a model file:

```bash
npm run test:e2e                                   # uses the first Ollama model
DOCMIND_GGUF=/path/model.gguf npm run test:e2e     # also exercises llama.cpp
```

## Packaging

```bash
npm run package   # unpacked app in dist/
npm run dist      # installer / bundle for the current platform
```

`electron-builder.yml` unpacks `*.node` and `node-llama-cpp` from the asar so
the native binaries stay loadable. `npmRebuild` is off because the ABI swap is
already handled by `scripts/native.mjs`.

---

## How it works

### 1. Import and parsing

Pick a folder with the Electron dialog. DocMind walks it recursively, reading
`.md`, `.mdx` and `.txt` (configurable), skipping `.git`, `node_modules`,
`.next`, `dist`, `build`, `coverage`, `vendor` and symlinked directories.

Markdown is split along its **natural heading structure** — ATX (`#`) and
setext (`===`) headings, ignoring anything inside fenced code blocks, skipping
YAML frontmatter. Each section keeps its heading, its full heading path
(`API reference > GET /me`), and the line range it came from. Fixed-size
chunking is a *fallback* that only kicks in for a section larger than ~700
tokens, and it splits on paragraph boundaries.

PDF is not supported in v1; `parseDocument()` is the single dispatch point
where a parser would be added.

### 2. Incremental reindex

Every document stores a SHA-256 of its content. On reindex each file is
classified as **added / changed / deleted / unchanged**, and an unchanged file
is never reparsed and never touches the FTS index. The report is shown on the
project dashboard.

### 3. Database

SQLite (WAL, foreign keys on) with `better-sqlite3` and Drizzle ORM.

| Table               | Holds                                                       |
| ------------------- | ----------------------------------------------------------- |
| `projects`          | folder, name, timestamps, `last_indexed_at`                 |
| `documents`         | relative path, filename, content hash, word count           |
| `sections`          | heading, heading path, content, line range, token estimate  |
| `sections_fts`      | FTS5 index over filename, heading, heading path, content    |
| `queries`           | question text, detected intent, symbols, keywords           |
| `retrieval_results` | per-query ranking: rank, score, score breakdown, selected   |
| `conversations`     | one thread per topic                                        |
| `messages`          | user/assistant turns with sources, timings and model stats  |
| `settings`          | a single validated JSON blob plus small runtime keys        |

In development the file is `data/docmind.db` inside the repo, so you can open
it with any SQLite client. Packaged builds use the per-user app data folder;
the exact path is shown in **Settings → Project**.

The FTS5 table uses a custom tokenizer:

```sql
tokenize = "unicode61 remove_diacritics 2 tokenchars '-_/'"
```

Treating `-`, `_` and `/` as word characters is what keeps `/me`,
`/api/users`, `USER_ID`, `DATABASE_URL` and `04-api-reference` as **single
searchable tokens** instead of being shredded into `me`, `api`, `users`,
`user`, `id`.

### 4. Query analysis

`analyzeQuery()` is pure heuristics — the model is never required to
understand a question:

```json
{
  "originalQuery": "La /me restituisce dati sbagliati",
  "symbols": ["/me"],
  "keywords": ["restituisce", "dati", "sbagliati"],
  "intent": "bug_investigation"
}
```

Symbol extraction recognises routes (`/me`, `/api/users`), HTTP verbs with a
path (`GET /me`, `POST /login`), classes (`UserService`, `UserController`),
functions (`getCurrentUser`), exceptions (`NullPointerException`), status
codes (`HTTP 500`), constants (`USER_ID`, `DATABASE_URL`), snake_case and
filenames, then strips trailing punctuation so `sulla /me,` still yields
`/me`. Keywords are the remaining content words minus an English + Italian
stopword list.

Intents: `question`, `bug_investigation`, `architecture`, `how_it_works`,
`dependency`, `error`, `data_flow`.

### 5. Retrieval and ranking

Two passes, then a single ranking:

1. **Exact pass** — every extracted symbol is matched against heading, heading
   path, filename and content, so an exact hit can never be crowded out of the
   candidate window by prose-only matches.
2. **FTS5 pass** — BM25 with per-column weights
   (`heading 12, heading_path 6, filename 6, content 1`).

Each candidate gets a breakdown that the UI shows verbatim:

| Component     | What it measures                                                             |
| ------------- | ---------------------------------------------------------------------------- |
| `exactSymbol` | where each query symbol was found, weighted by **coverage** — a heading that *is* `GET /me` beats one that merely mentions it |
| `heading`     | symbol or keyword match in the heading / heading path                        |
| `filename`    | symbol or keyword match in the filename                                      |
| `fts`         | BM25, normalised against the best hit of this query                          |
| `keyword`     | keyword overlap inside the section body                                      |
| `intent`      | how well the section matches the detected intent (a bug report prefers the troubleshooting section) |

The weights are all editable in **Settings → Retrieval**. Selection takes
between `minSections` and `maxSections` (default 3–6), drops anything below
20% of the top score, and caps how many sections a single document may
contribute so the context covers more ground.

### 6. Context builder

The selected sections become one compact prompt, hard-limited by
`maxContextChars`:

```
QUESTION

Mi hanno aperto un bug: /me restituisce informazioni sbagliate.

DOCUMENTATION

[SOURCE 1]
File: 04-api-reference.md
Heading: API reference > GET /me
Lines: 19-54

...

INSTRUCTIONS

- Answer the question using only the supplied documentation.
- Separate facts from hypotheses.
- If the documentation does not contain enough information, explicitly say so.
- Never invent classes, routes, tables or behavior.
- Mention the sources supporting important statements, as [SOURCE n].
```

### 7. Local model

```ts
interface LLMProvider {
  initialize(): Promise<void>
  healthCheck(): Promise<boolean>
  generate(request: GenerateRequest): AsyncIterable<GenerationEvent>
  unload(): Promise<void>
}
```

- **`LocalGGUFProvider`** — `node-llama-cpp` / llama.cpp. Configurable model
  path, context size, temperature, max tokens, CPU threads and GPU layers
  (Metal / CUDA offload). The module is loaded lazily and is an *optional*
  dependency, so a missing or broken install degrades to an error message
  instead of a crash.
- **`OllamaProvider`** — plain HTTP against a local daemon, no extra
  dependency. It sends `think: false` so a reasoning model spends its token
  budget on the answer rather than on a hidden thinking block, and retries
  without the flag on older daemons.

`ModelManager` owns the single active provider and publishes its state
(`unloaded / loading / ready / generating / error`) to the toolbar.

## Selecting a GGUF model

1. Open **Model** in the sidebar.
2. Choose the **Local GGUF** tab → **Select .gguf file**.
3. DocMind reads the GGUF metadata without loading the weights and shows the
   filename, size, context length, architecture and parameter count, plus a
   *valid / invalid* verdict.
4. Press **Set as active model**. The context size is clamped to what the file
   declares.

Any quantized instruction-tuned model works; 1–4B models answer fastest on a
laptop. Automatic downloads are not implemented — the button is present and
disabled so the wiring is obvious.

For Ollama: open the **Ollama** tab, check the daemon URL, press **Refresh**,
and click a model to activate it.

## The retrieval graph

The graph is **not** a persistent knowledge graph. It is a temporary picture of
the process that answered *this* question, built only from events the pipeline
really emitted:

```
query_received → query_analyzed → search_started → search_match … →
search_completed → ranking_started → ranking_completed → context_selected →
generation_started → generation_token … → generation_completed
```

Rendered with React Flow as
`QUERY → SEARCH → DOCUMENTS → SECTIONS → CONTEXT → LOCAL AI → ANSWER`.

Section nodes appear as they are found, carrying the retrieval-stage score;
`ranking_completed` re-weights them with the final scores. Weaker matches fade
out, selected sections are highlighted and are the only ones wired into the
CONTEXT node. Clicking a section node opens the document viewer on that exact
section. Once generation finishes the graph stays on screen for inspection.

If a stage never happened, no node lights up for it.

## Demo

`demo/example-project/` is a fictional "Acme Identity API" documentation set
covering `GET /me`, `UserController`, `UserService`, `UserRepository`,
`ProfileService`, the `users` and `profiles` tables and JWT authentication.

```bash
npm run seed:demo -- ollama qwen3.5:2b
npm run dev
```

Then ask:

> Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate

Retrieval really finds `GET /me` (04-api-reference.md), *Stale or wrong data
on GET /me* (07-error-handling.md) and *GET /me returns the wrong user's data*
(10-troubleshooting.md) — the sections that document `UserController.me()`,
`UserService.getCurrentUser()` and the `profiles.user_id` duplication. Nothing
about that answer is hardcoded.

## Project layout

```
src/
  main/
    database/     client, Drizzle schema, raw DDL, repositories
    filesystem/   recursive scanner, ignore rules, content hashing
    ingestion/    markdown/section splitter, incremental indexer
    retrieval/    symbols, analyzer, FTS search, ranking, context, pipeline
    llm/          provider interface, GGUF provider, Ollama provider, manager
    ipc/          every ipcMain handler, each wrapped in a Result envelope
  preload/        the contextBridge surface (the only renderer↔main door)
  renderer/src/
    components/   shell, chat, sources panel, document viewer
    graph/        React Flow nodes and the retrieval graph
    pages/        Home, Overview, Ask, Documents, History, Model, Settings
    stores/       Zustand stores for app, chat and graph state
  shared/         Zod schemas, event and IPC types shared by both sides
tests/            Vitest suites + the opt-in real-model e2e test
demo/             the example documentation project
data/             development SQLite database (gitignored)
```

## Error handling

Every IPC handler returns `{ ok: true, data } | { ok: false, error }`, so a
failure surfaces as a message in the UI instead of an exception. Specifically
handled: missing folder, folder without documents, unreadable file, database
open failure, missing model, invalid GGUF, a context larger than the model
window, generation failure and cancellation. When generation fails but
retrieval succeeded, the answer is replaced by the ranked list of sources
rather than by nothing.

## License

MIT
