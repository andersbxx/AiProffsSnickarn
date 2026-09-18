# AiProffsSnickarn

**C-compiler PWA for iPad (Safari) with keyboard.** Sister project to [AiSnickarn](https://github.com/andersbxx/AiPlayground). Vanilla JS, no build step.

## Features

- **C (ISOC99)** compilation via [tcc-wasm](https://github.com/44670/tcc-wasm) → wasm32 → WAT → wabt → wasm → runtime
- **CodeMirror 6** editor with C syntax highlighting, Tab indent, ⌘S / ⌘⏎ shortcuts
- **OPFS** file storage (persistent across reloads)
- **Git per project** (isomorphic-git): auto-commit on ⌘S, new file, delete, successful run
- **AI panel** (slide-over): Gemini integration with two modes
  - **Bygga** — generates C code, applies to editor, auto-commits
  - **Planera** — text discussion, "Bygg det här" chip to switch
- **PWA** (standalone + landscape): app-shell + CM6 + isomorphic-git + AI precached; compiler lazy-loaded

## Quick Start

```bash
# Dev server (Crostini Linux container)
python3 -m http.server 8000

# Open in Chromebook Chrome:
# http://penguin.linux.test:8000
# Or via port-forwarding: http://<chromebook-ip>:8000
```

## Architecture

```
src/main.c  ──tcc-wasm──▶  WAT  ──wabt──▶  .wasm  ──runtime.js──▶  {rc, stdout, stderr}
      │
      ├─ OPFS (projects/<uuid>/*.c)
      ├─ Git (.git/ per project, branch main)
      └─ AI panel (Gemini, localStorage API key)
```

### Stack

| Layer | Tech |
|-------|------|
| Editor | CodeMirror 6 (ESM via importmap, vendored) |
| Compiler | tcc-wasm + wabt (lazy, network-first) |
| Git | isomorphic-git 1.42.2 (UMD, OPFS fs-adapter) |
| AI | Gemini REST API (fallback chain, 24h model cache) |
| Storage | OPFS + localStorage (settings, AI models, sessions) |
| PWA | Service Worker (app-shell precache, compiler lazy) |

### Key Files

```
├── index.html              # App shell + AI panel HTML
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
├── css/style.css           # Dark glassmorphism theme
├── js/
│   ├── app.js              # Main orchestrator
│   ├── editor.js           # CodeMirror 6 (ESM)
│   ├── compiler.js         # tcc-wasm + wabt loader
│   ├── storage.js          # OPFS wrapper
│   ├── git.js              # isomorphic-git API
│   ├── gitfs.js            # OPFS fs-adapter
│   ├── ai.js               # Gemini wrapper (fallback chain)
│   └── ai-panel.js         # AI panel UI
├── vendor/
│   ├── buffer.min.js       # Buffer polyfill for isomorphic-git
│   ├── isomorphic-git.min.js
│   ├── tcc.wasm / libc.wasm / runtime.js / wabt.js / ide-resources.js
│   └── cm/*.mjs            # CodeMirror 6 ESM modules
├── test-m*.py              # Selenium headless tests
└── vendor-cm.py            # Vendoring script for CM6
```

## Development

### Vendoring CodeMirror 6

```bash
python3 vendor-cm.py
```

Downloads 16 packages to `vendor/cm/` and generates `vendor/cm/importmap.json`.

### Testing

```bash
# Milestone tests (headless Chrome + Selenium)
python3 test-m2.py   # M2: shell + OPFS
python3 test-m3.py   # M3: CodeMirror editor
python3 test-m4.py   # M4: compile + run panel
python3 test-m5.py   # M5: Git auto-commit
python3 test-m6.py   # M6: AI panel
```

### Deployment

- Static hosting (GitHub Pages, Netlify, etc.)
- Push only after manual confirmation; poll Pages status until `built`
- No secrets in code (API key stored client-side in localStorage)

## License

MIT — see [LICENSE](LICENSE) if present.