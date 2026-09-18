# AGENTS.md — AiProffsSnickarn

C-kompilator-PWA för iPad (Safari) med tangentbord. Systerprojekt till AiPlayground (AiSnickarn). Separat repo, pusha endast efter användarbekräftelse.

## Arkitektur (låsta beslut)
- **Bara C** (ISOC99), ingen C++/STL.
- **Kompilator:** 44670/tcc-wasm-fork (wasm32-backend): `vendor/tcc.wasm` + `vendor/libc.wasm`, driver `vendor/runtime.js` (ABI: `TccWasmRuntime.CompilerHost`/`AppRuntime`).
- **Kedja:** C-källkod → `compileAppResult` → WAT (text) → `wabt`-assemblering (`WabtModule()`) → wasm-binary → `AppRuntime.run(binary, {stdin})` → `{rc, stdout, stderr}`.
- **Headers:** base64 i `vendor/ide-resources.js` (`TccWasmIdeResources`), matas in via `CompilerHost`-option `resources`.
- **Editor:** CodeMirror 6 via lokal importmap + venderade ESM (`@codemirror/lang-c`), ingen build-step.
- **Filer:** OPFS + egen liten isomorphic-git-fs-adapter (~80 rader), fallback LightningFS.
- **Git:** isomorphic-git (UMD vendrad), per projekt, branch `main`, auto-commit: ⌘S, före/efter AI-redigering, efter lyckad kompilering.
- **AI:** Gemini, samma mönster som AiSnickarn (nyckel i `localStorage`, fallback-lista vid 503/429), inga hemligheter i kod.
- **PWA:** manifest standalone + landscape. App-shell + CodeMirror + isomorphic-git + AI-kärna precachas; **kompilatorn precachas EJ** (lazy + SW fetch-then-cache).
- **iOS-hårdning:** wasm `memory.max` ≤ 512 MB, enkeltrådat (ingen `shared`, ingen asyncify), kompilator minne fixerat via `pages` (som default 4096 sidor = 256 MB).

## WAT-assembleringsregler
Använd samma features som referens-IDE:n:
```
exceptions, mutable_globals, sat_float_to_int, sign_extension,
multi_value, bulk_memory, reference_types
```
`parseWat("input.wat", wat, features)` → `resolveNames()` → `validate()` → `toBinary().buffer`.

## Test (headless)
- **Spike:** `python3 spike-test.py` (kör lokal HTTP-server + Selenium/headless-Chrome via CDP). Förväntat grönt: `SPIKE PASS`, `rc 0`, `fib(10)=55`. (`chromedriver`-varningsrad från Selenium vid teardown är ofarlig.)
- **M2-skall + OPFS:** `python3 test-m2.py` (färsk profil i /tmp, PORT slumpad). Täcker: boot → skapa projekt → main.c-starter → byte av namn → andra projekt → SW+cache → persistens efter reload → radera. Grönt: `M2 TEST PASS`.
- **M3-redigerare:** `M3 TEST PASS` — CodeMirror 6 vendrad som ES-moduler (`vendor/cm/*.mjs`, källa `vendor-cm.py`, 16 paket inkl. `@lezer/cpp` + `@marijn/find-cluster-break`), importmap i `index.html`). **OBS**: `@codemirror/lang-c` existerar inte — använd `@codemirror/lang-cpp` (exporterar `cpp()` för både C och C++). `@codemirror/view` ≥ 6.38 krävs (search importerar `getDialog`). `indentWithTab` är i commands 6.11 ett keybind-objekt, inte en extension — lägg i `keymap.of([...])`. Testet täcker: redigera→spara→reload→ny fil→växla→radera.
- **M4-körpanel:** `M4 TEST PASS` — `js/compiler.js` laddar lazy (`vendor/ide-resources.js`, `runtime.js`, `wabt.js`, sedan `CompilerHost`+`AppRuntime`+`WabtModule`) och exponerar `globalThis.AiProffsCompiler.compileAndRun(source, stdin)`. Körknapp + utdatapanel (stdout/stderr/diagnostics/rc, mörk panel). **OBS**: `compileAppResult` kastar (inte returnerar rc≠0) vid kompilatorfel — fånga try/catch. wabt/runtime/ide-resources laddas via dynamiska `<script>`-taggar (lazy, network-first).
- **M5-Git:** `M5 TEST PASS` — isomorphic-git (UMD vendrad) + egen OPFS-fs-adapter (`js/gitfs.js`). Auto-commit vid ⌘S (`Spara <fil>`), ny fil (`Ny fil <fil>`), radera (`Radera <fil>`), lyckad körning (om ändringar). `js/git.js` exponerar `AiProffsGit` (`ensure`, `commitAll`, `log`, `count`, `forget`). `js/gitfs.js` OPFS-adapter med `Stats`/`Dirent`. `buffer.min.js` polyfill för isomorphic-git. `sw.js` precachar `isomorphic-git.min.js`, `gitfs.js`, `git.js`, `buffer.min.js`. `test-m5.py` grönt. M3/M4 har oförändrade flakiga tester (oförändrat från tidigare).
- **M6-AI-panel:** `M6 TEST PASS` — AI-panel (slide-over) med Gemini-integration. Inställningar-sheet för API-nyckel + modellval (dynamisk modellista från Gemini API, 24h cache). Två lägen: **Bygga** (genererar C-kod, auto-commit) och **Planera** (text-svar). Förslagschips, toast-notifieringar, markdown-rendering. Auto-commit före/efter AI-redigering. `js/ai.js` (Gemini-wrapper med fallback-kedja), `js/ai-panel.js` (UI). `test-m6.py` grönt.
- **Test-hook:** `window.__AI_PROFFS_TEST__` (app.js) och `window.__spike` (spike.html). CDP-`Runtime.evaluate` delar global lu-clear-lexikal-scope: återanvänd inte `const i` mellan evals (använd `var`). Vidare tester: samma mönster som AiPlayground (`/tmp/opencode/test_*.py`).

## Konventioner
- Vanilla ES modules, ingen ramverk/build-step. Ingen kommentarspadding i kod som inte hör sakfrågan.
- README på engelska, guider på svenska.
- Push-regel: vänta på användarens `ok`, polla sedan Pages-status, verifiera med curl (CDN-cache-lag kan kräva retry).