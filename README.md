# DocMind

**Ask your project's documentation. Everything stays local.**

DocMind is a desktop app that indexes a folder of technical documentation,
retrieves only the sections that actually answer your question, and hands
those sections to a small language model running on your own machine.

Nothing is trained and nothing is embedded in a cloud service. Documentation is
retrieved *dynamically* at question time.

Retrieval, indexing and the database **always** run locally. The only choice
that can change that is which model writes the answer: a local GGUF model keeps
everything on the laptop, while the optional Codex and Claude Code providers
send the retrieved excerpts to their vendor. The app says which one is active,
in those words, before anything is sent.

```
DOCUMENTATION FOLDER → PARSER → SECTIONS → SQLITE FTS5
                                                ↓
        ANSWER + SOURCES ← SMALL LOCAL LLM ← CONTEXT BUILDER
                                                ↑
                      TOP SECTIONS ← RANKING ← SEARCH ← QUERY ANALYSIS ← USER QUERY
```

---

## Download

Prebuilt applications are attached to every release:

### **[⬇ Download the latest release](https://github.com/markuz899/docMindApp/releases/latest)**

| Platform | File | Notes |
|---|---|---|
| macOS · Apple Silicon | `DocMind-<version>-mac-arm64.dmg` | M1/M2/M3/M4 |
| macOS · Intel | `DocMind-<version>-mac-x64.dmg` | |
| Windows | `DocMind-<version>-win-x64.exe` | NSIS installer, pick your own folder |
| Linux | `DocMind-<version>-linux-x86_64.AppImage` | `chmod +x`, then run |
| Linux · Debian/Ubuntu | `DocMind-<version>-linux-amd64.deb` | `sudo apt install ./<file>.deb` |

Each build is produced on its own operating system by
[`.github/workflows/release.yml`](.github/workflows/release.yml) — never
cross-compiled, because `better-sqlite3` and `node-llama-cpp` ship
per-platform, per-architecture binaries.

### The builds are not code-signed

There is no Apple Developer ID and no Windows code-signing certificate, so both
systems will warn about an unidentified developer. This is expected, and you
should only bypass it because you trust this repository.

**macOS** — the download is quarantined, and an unsigned app usually fails with
*"DocMind is damaged and can't be opened"*. Clear the flag once, after moving
the app to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/DocMind.app
```

**Windows** — SmartScreen shows *"Windows protected your PC"*. Choose
**More info → Run anyway**.

**Linux** — no warning; just make the AppImage executable:

```bash
chmod +x DocMind-*.AppImage && ./DocMind-*.AppImage
```

If you would rather not trust a binary, building from source takes one command
— see [Install](#install) and [Packaging](#packaging).

## Requirements

- **Node.js 20 or newer** (22 recommended — the build is verified on 22.19).
- macOS, Linux or Windows.
- Optionally a model to write the answers:
  - a **`.gguf`** file, run through `llama.cpp` (`node-llama-cpp`) — downloaded
    from the DocMind catalog or imported from disk;
  - a running **[Ollama](https://ollama.com)** daemon;
  - the **Codex CLI**, signed in with your ChatGPT plan;
  - **Claude Code**, signed in with your Claude plan.

DocMind never asks for an API key and never falls back to metered API billing.

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
npm test            # Vitest (parser, indexer, FTS, ranking, context, DB,
                    #   providers, registry, downloads, checksums, settings)
npm run build       # typecheck + production bundles into out/
```

The end-to-end test against a **real** local model is opt-in, because it needs
a daemon or a model file:

```bash
npm run test:e2e                                   # uses the first Ollama model
DOCMIND_GGUF=/path/model.gguf npm run test:e2e     # also exercises llama.cpp
```

The subscription providers have their own opt-in end-to-end test. It spends
plan quota, so `npm test` never runs it, and each provider needs its API-key
variable absent — the same configuration the provider requires at runtime:

```bash
env -u OPENAI_API_KEY    DOCMIND_E2E_CODEX=1  npm run test -- tests/e2e.subscription.test.ts
env -u ANTHROPIC_API_KEY DOCMIND_E2E_CLAUDE=1 npm run test -- tests/e2e.subscription.test.ts
```

Everything else mocks the network, the CLIs and the filesystem, so the normal
suite spends no quota and touches no network.

## Packaging

```bash
npm run package   # unpacked app in dist/
npm run dist      # installer / bundle for the current platform
```

`electron-builder.yml` unpacks `*.node` and `node-llama-cpp` from the asar so
the native binaries stay loadable. `npmRebuild` is off because the ABI swap is
already handled by `scripts/native.mjs`.

Releases are cut by pushing a tag; `.github/workflows/release.yml` builds each
platform on its own runner and uploads the artifacts to the GitHub release:

```bash
npm version patch          # or minor / major
git push --follow-tags
```

`scripts/after-pack.js` gives the macOS bundle a valid ad-hoc signature. Without
it the app keeps Electron's own signature while carrying a renamed executable
and a new `app.asar`, so the seal no longer matches and macOS reports the app as
damaged. Ad-hoc signing does not make it *trusted* — that still needs an Apple
Developer ID — but it makes the bundle internally valid.

The app icon is generated from the renderer's own colour tokens:

```bash
python3 scripts/make-icons.py   # writes resources/icon.{png,ico,icns}
```

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

### 7. AI providers

One pipeline, four backends. Whatever is active, the stages before it are
identical:

```
retrieval → context builder → AIProvider → streaming answer
```

```ts
interface LLMProvider {
  initialize(): Promise<void>
  healthCheck(): Promise<boolean>
  generate(request: GenerateRequest): AsyncIterable<GenerationEvent>
  unload(): Promise<void>
  describe(): ProviderDescription
}
```

```
LLMProvider
├── LocalGGUFProvider       local   llama.cpp / Metal / CUDA
├── OllamaProvider          local   HTTP against a local daemon
├── CodexCliProvider        subscription  codex exec
└── ClaudeCodeCliProvider   subscription  claude -p
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
- **`CodexCliProvider`** / **`ClaudeCodeCliProvider`** — see below.

`ModelManager` owns the single active provider and publishes its state
(`unloaded / loading / ready / generating / error`) to the toolbar.
`createModelsService` owns everything else: the catalog, downloads, installed
models and provider detection.

Switching provider is transactional. The current provider is unloaded, the new
one is loaded and must pass a health check; if anything fails, the settings roll
back to what worked. The app never shows a provider as "active" while it cannot
answer.

## Privacy: local vs subscription

This is the one distinction the UI never blurs.

| Provider | What leaves the machine |
|---|---|
| DocMind / custom GGUF | *Runs entirely on this computer. Your project context is not sent to an AI provider.* |
| Ollama | *Runs entirely on this computer through the local Ollama daemon.* |
| Codex | *Relevant documentation selected by retrieval will be sent to OpenAI through Codex.* |
| Claude Code | *Relevant documentation selected by retrieval will be sent to Anthropic through Claude Code.* |

The first time a subscription provider is selected, DocMind asks:

> DocMind will send only the documentation excerpts selected by retrieval,
> together with your question, to [provider]. The complete project is not
> uploaded automatically.

The choice is stored. Until it is given, the provider cannot be activated — the
main process enforces this, not just the UI.

What is sent is exactly the system instruction, the question, the retrieved
sections and their source metadata. Not the repository, not the docs folder, not
the database, not unrelated history.

## Subscription providers

Both use a CLI that **you** installed and signed in to. DocMind never reads,
copies or stores a credential, and never talks to `api.openai.com` or
`api.anthropic.com` itself.

### Codex CLI

Verified against `codex-cli 0.154.0`.

```bash
npm i -g @openai/codex
codex login          # sign in with the ChatGPT account that carries your plan
```

DocMind runs:

```
codex exec --json --sandbox read-only --skip-git-repo-check --ephemeral --cd <tmp> -
```

Read-only sandbox, a temporary working directory, no persisted session, prompt
on stdin. Codex is an answer engine here, never an agent: it cannot read or
change your project.

**Codex does not stream.** At this version `codex exec --json` emits the
assistant message once, complete, with no token deltas — so DocMind delivers it
as one chunk rather than faking a stream. The retrieval graph still shows the
real stages.

### Claude Code

Verified against `Claude Code 2.1.274`.

```bash
npm i -g @anthropic-ai/claude-code
claude auth login    # sign in with the account that carries your Claude plan
```

DocMind runs:

```
claude -p --output-format stream-json --include-partial-messages --verbose \
       --restricted --strict-mcp-config --tools "" --system-prompt <…>
```

`--tools ""` and `--restricted` remove every tool, `--strict-mcp-config` drops
MCP servers. Claude Code **does** emit real token deltas, so this provider
streams for real.

Health is read from `claude auth status --json` — a status summary, never a
credential file.

### API key safety

If `ANTHROPIC_API_KEY` is present in the environment, Claude Code may bill your
API account instead of your subscription. DocMind detects this and **disables
the provider by default**:

> ANTHROPIC_API_KEY detected. Claude Code may use API billing instead of your
> Claude subscription. Remove the environment variable or explicitly acknowledge
> this configuration.

The same rule applies to `OPENAI_API_KEY` and Codex. DocMind **never unsets the
variable for you** — it stops and lets you decide. Acknowledging the risk is an
explicit checkbox on the AI Models page.

There is no fallback path. If Codex fails, you get the Codex error; you never
silently get a metered API call.

### Plan limits

Usage limits are an expected outcome, not a crash. DocMind recognises them and
says so, without retrying aggressively:

> Codex usage limit reached. Your DocMind local models are still available.

Falling back is always **explicit** — the app offers to switch to a local model
and never changes provider behind your back.

## AI Models page

**AI Models** in the sidebar, plus a quick `AI: <model> ▾` switcher in the
toolbar.

### Local models

Downloadable DocMind models come from a remote JSON manifest, validated with
Zod. Cards show parameters, quantization, size, version and a RAM verdict based
on `os.totalmem()`, `os.platform()` and `os.arch()`:

```
8 GB RAM detected.
Recommended: DocMind Lite
Compatible:  DocMind Balanced
```

These are the manifest's own `recommendedRamGb` / `minimumRamGb` compared
against detected memory — not an invented hardware score. Benchmark metrics are
shown only when the manifest actually carries them; a `null` metric is hidden
rather than rendered as zero.

Downloads report real bytes, percentage and speed, and can be cancelled:

```
DocMind Lite
Downloading…  243 MB / 398 MB   61%   12.4 MB/s   [ Cancel ]
Verifying SHA256…  →  Installing…  →  Ready ✓
```

Bytes land in `model.gguf.part` and are renamed into place **only** after the
SHA256 matches the manifest. A mismatch deletes the file and refuses the
install. Nothing counts as installed until it is complete and verified.

**Resume is not implemented.** A cancelled download restarts from zero. The
download manager is structured so HTTP Range resume can be added later, but
today it does not exist.

Downloads are HTTPS-only. Redirects are followed by hand, at most five hops,
each re-checked — a catalog entry cannot bounce the download onto plain HTTP. A
GGUF file is treated purely as data and is never executed.

### Model storage

```
<app.getPath('userData')>/models/
  docmind-lite-0.5b-q4/
    model.gguf
    metadata.json
  registry-cache.json
```

No hardcoded per-OS paths. `metadata.json` is what makes an install real, so a
settings reset does not lose downloaded models.

**Delete** only ever removes a DocMind-managed model directory, after a
confirmation, unloading it first if it is active. It refuses to touch anything
that is not a managed model.

### Custom GGUF

**Import .gguf** reads the file's metadata without loading the weights and shows
filename, size, context length, architecture, quantization and parameter count,
plus a *valid / invalid* verdict. The file **stays where it is** — DocMind
stores the path, not a copy. A file later moved or deleted shows up as
unusable instead of breaking the app. "Remove from list" forgets the path and
never deletes your file.

### Model registry

Resolution order is Settings → `DOCMIND_MODEL_REGISTRY_URL` → the built-in
default, the official DocMind Lite 0.5B (v2) catalog published on Hugging
Face (`markuz89/docmind-lite-0.5b`). A fresh clone works out of the box with
no configuration.

```bash
DOCMIND_MODEL_REGISTRY_URL=https://…/manifest.json npm run dev
# development: a local fixture works too
DOCMIND_MODEL_REGISTRY_URL=$PWD/tests/fixtures/model-registry.json npm run dev
```

Override it in Settings → AI Models → Advanced → Model registry to point at a
different catalog.

See **[docs/MODEL_PUBLISHING.md](docs/MODEL_PUBLISHING.md)** for the manifest
format and the publishing workflow, including the Hugging Face hosting
strategy: the manifest holds plain HTTPS URLs, so hosting can move without
changing the Model Manager.

### Offline

Everything keeps working offline. The last valid manifest is cached, and the
page says *"Model catalog last updated …"* when it is serving the cached copy.
An unreachable registry is a notice, never a blocker — installed models,
custom GGUF files and Ollama all stay available.

A newer `version` in the manifest shows **Update available**. DocMind never
replaces an installed model on its own.

### What is persisted

Active provider and model, custom model paths, registry URL, downloaded model
metadata, the privacy confirmation and provider preferences.

**Never persisted:** API keys, auth tokens, cookies, OAuth credentials. The
settings schema has no field that could hold one.

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
`QUERY → SEARCH → DOCUMENTS → SECTIONS → CONTEXT → <provider> → ANSWER`.

The provider node reflects whichever backend actually answered — `DocMind Lite`,
`Codex`, `Claude Code`, an Ollama tag — taken from the `generation_started`
event, not from a setting. Its kicker reads `local ai` or `subscription ai`
accordingly.

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
    llm/          provider interface, GGUF, Ollama, Codex CLI, Claude Code,
                  shared CLI helpers, manager
    models/       registry + cache, model store, download manager, hardware,
                  catalog service
    ipc/          every ipcMain handler, each wrapped in a Result envelope
  preload/        the contextBridge surface (the only renderer↔main door)
  renderer/src/
    components/   shell, chat, sources panel, document viewer, AI selector
    graph/        React Flow nodes and the retrieval graph
    pages/        Home, Overview, Ask, Documents, History, AI Models, Settings
    stores/       Zustand stores for app, chat, graph and model state
  shared/         Zod schemas, event and IPC types shared by both sides
docs/             MODEL_PUBLISHING.md — how to ship an official model
tests/            Vitest suites, fixtures, and the opt-in e2e tests
demo/             the example documentation project
data/             development SQLite database (gitignored)
```

## Error handling

Every IPC handler returns `{ ok: true, data } | { ok: false, error }`, so a
failure surfaces as a message in the UI instead of an exception. Specifically
handled: missing folder, folder without documents, unreadable file, database
open failure, missing model, invalid GGUF, a context larger than the model
window, generation failure and cancellation. For the provider manager:
unreachable registry, invalid manifest, non-https URL, checksum mismatch,
cancelled download, a missing or unauthenticated CLI, a detected API key, plan
usage limits, and a provider that loads but fails its health check. When
generation fails but
retrieval succeeded, the answer is replaced by the ranked list of sources
rather than by nothing.

## License

MIT
