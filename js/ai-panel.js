// ————— ai-panel.js —————
// AI-panel UI för AiProffsSnickarn. Inlinar ai.js-funktioner för att undvika cache-problem.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS_CACHE_KEY = 'AI_MODELS_CACHE';
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000;

async function listModels(apiKey, force) {
  if (!apiKey) return [];

  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || 'null');
      if (cached && cached.ts && Date.now() - cached.ts < MODELS_CACHE_TTL) {
        return cached.models;
      }
    } catch (_) {}
  }
  const url = `${API_BASE}?key=${apiKey}&pageSize=1000`;
  let data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    data = await res.json();
  } catch (_) {
    try {
      const cached = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || 'null');
      if (cached && cached.models) return cached.models;
    } catch (__) {}
    throw new Error('kunde inte hämta modelllista (nätverk eller timeout)');
  }

  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1)
    .map((m) => m.name.replace('models/', ''))
    .sort();

  if (models.length) {
    try { localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify({ ts: Date.now(), models })); } catch (_) {}
  }
  return models;
}

const SYSTEM_PROMPT = [
  'Du är en hjälpsam AI som bygger C-kod för en inbäddad kompilator-PWA (tcc-wasm).',
  'Du svarar ALLTID med ren JSON enligt schemat: { "code": "komplet C-källkod" }.',
  'Koden ska vara en komplett, kompilerbar C-fil (ISOC99, tcc-kompatibel).',
  'Använd standardbibliotek (stdio, stdlib, string, math, etc). Inga POSIX/OS-specifika anrop.',
  'Inkludera ALLA nödvändiga #include. main() måste finnas.',
  'Returnera ALLTID hela den uppdaterade filen — aldrig diffar, aldrig fragment.',
  'Anpassa alltid efter användarens senaste feedback och ändringar i historiken.',
  'Om användaren frågar om något som inte är C-kod, förklara kort och returnera { "code": "", "text": "förklaring" }.',
].join('\n');

const PLAN_PROMPT = [
  'Du är en AI-planerare som hjälper en C-utvecklare att tänka klart innan kodning.',
  'Du BYGGER INTE kod nu — ingen C-kod, ingen JSON, inga demos.',
  'Ditt jobb: utforska och förtydliga idén, ställ klargörande frågor, föreslå struktur, algoritmer och upplägg.',
  'Svara på svenska i korta, läsbara stycken med punktlistor när det passar.',
  'Avsluta gärna med en sammanfattning av vad du tänker implementera och fråga om du ska sätta igång.',
].join('\n');

const FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest'
];

async function callAi(history, userMessage, apiKey, modelId) {
  return generateWithFallback(history, userMessage, apiKey, modelId, SYSTEM_PROMPT, 'application/json');
}

async function callAiText(history, userMessage, apiKey, modelId) {
  return generateWithFallback(history, userMessage, apiKey, modelId, PLAN_PROMPT, 'text/plain');
}

async function generateWithFallback(history, userMessage, apiKey, modelId, systemPrompt, mime) {
  const chain = [modelId, ...FALLBACKS.filter((m) => m !== modelId)];
  let lastError = null;

  for (const current of chain) {
    try {
      const content = await generateOnce(history, userMessage, apiKey, current, systemPrompt, mime);
      return { ...content, model: current };
    } catch (e) {
      lastError = e;
      if (e.status !== 503 && e.status !== 429) throw e;
    }
  }
  throw lastError || new Error('Inga modeller svarade.');
}

async function generateOnce(history, userMessage, apiKey, modelId, systemPrompt, mime) {
  const url = `${API_BASE}/${modelId}:generateContent?key=${apiKey}`;

  const contents = [
    ...history.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: userMessage }] }
  ];

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { responseMimeType: mime, temperature: 0.7 }
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('Nätverksfel: kunde inte nå Gemini. Kontrollera internetanslutningen.');
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch (_) {}
    const status = response.status;
    if (status === 400) throw new Error(`400 Bad Request — kontrollera att modell-ID är giltigt: ${modelId}\n${detail.slice(0, 300)}`);
    if (status === 403) throw new Error(`403 Forbidden — API-nyckeln saknas eller är ogiltig.`);
    if (status === 429 || status === 503) {
      const e = new Error(`${status === 429 ? '429 Too Many Requests' : '503 överbelastad'} — modellen "${modelId}" just nu.`);
      e.status = status;
      throw e;
    }
    throw new Error(`Gemini API-fel (${status}): ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const candidate = data && data.candidates && data.candidates[0];
  const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
  const text = part && part.text;
  if (!text) throw new Error('Inget innehåll i Gemini-svaret. Försök igen.');

  if (mime === 'text/plain') return { text };

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.code === 'string') return { code: parsed.code };
    if (typeof parsed.html === 'string') return { code: parsed.html };
  } catch (_) {}

  throw new Error('Gemini returnerade inte giltig JSON med fältet "code". Testa en annan modell.');
}

function initSettings(apiKey, modelId) {
  if (apiKey) localStorage.setItem('AI_KEY', apiKey);
  if (modelId) localStorage.setItem('AI_MODEL', modelId);
  return { key: localStorage.getItem('AI_KEY'), model: localStorage.getItem('AI_MODEL') };
}

function loadSettings() {
  return { key: localStorage.getItem('AI_KEY'), model: localStorage.getItem('AI_MODEL') };
}

function clearSettings() {
  localStorage.removeItem('AI_KEY');
  localStorage.removeItem('AI_MODEL');
}

const SESSIONS_KEY = 'AI_SESSIONS';
const ACTIVE_KEY = 'AI_ACTIVE_SESSION';
const MODE_KEY = 'AI_MODE';

const state = {
  settings: null,
  history: [],
  busy: false,
  sessions: [],
  activeId: null,
  mode: 'build',
  currentFile: null,
  currentProjectId: null
};

const $ = (id) => document.getElementById(id);

let elements = {};

function initElements() {
  elements = {
    aiBtn: $('aiBtn'),
    aiPanel: $('aiPanel'),
    aiClose: $('aiClose'),
    aiModelChip: $('aiModelChip'),
    aiModelChipText: $('aiModelChipText'),
    aiChatContainer: $('aiChatContainer'),
    aiEmptyState: $('aiEmptyState'),
    aiPromptInput: $('aiPromptInput'),
    aiSendBtn: $('aiSendBtn'),
    aiInputHint: $('aiInputHint'),
    aiToast: $('aiToast'),
    aiSettingsSheet: $('aiSettingsSheet'),
    aiApiKey: $('aiApiKey'),
    aiEyeBtn: $('aiEyeBtn'),
    aiModelSelect: $('aiModelSelect'),
    aiRefreshModels: $('aiRefreshModels'),
    aiModelHint: $('aiModelHint'),
    aiCloseSheet: $('aiCloseSheet'),
    aiCustomModelGroup: $('aiCustomModelGroup'),
    aiCustomModel: $('aiCustomModel'),
    aiStartBtn: $('aiStartBtn'),
    aiModeBygga: $('aiModeBygga'),
    aiModePlaner: $('aiModePlaner'),
    aiSuggestChips: $('aiSuggestChips'),
  };
}

let toastTimer = null;
function toast(text) {
  if (!elements.aiToast) return;
  elements.aiToast.textContent = text;
  elements.aiToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.aiToast.classList.remove('show'), 2200);
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "\'" }[c]));
}

function renderMarkdown(src) {
  if (!src) return '';
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&', '<': '<', '>': '>' }[c]));
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
      /^(https?:|mailto:)/i.test(u)
        ? '<a href="' + u.replace(/"/g, '"') + '" target="_blank" rel="noopener noreferrer nofollow">' + t + '</a>'
        : t);

  const lines = esc(String(src)).split('\n');
  const tokens = [];
  const body = [];
  let i = 0;
  while (i < lines.length) {
    if (/^```/.test(lines[i])) {
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) i++;
      tokens.push('<pre><code>' + buf.join('\n') + '</code></pre>');
      body.push('\u0000' + (tokens.length - 1) + '\u0000');
    } else {
      body.push(lines[i]);
      i++;
    }
  }

  let html = '';
  let open = null;
  let para = [];
  const closePara = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
  const closeQuote = () => { if (open === 'quote') { html += '</blockquote>'; open = null; } };
  const closeList = () => { if (open === 'ul') { html += '</ul>'; open = null; } if (open === 'ol') { html += '</ol>'; open = null; } };
  const closeAll = () => { closePara(); closeQuote(); closeList(); };

  for (const raw of body) {
    if (/^\s*$/.test(raw)) { closeAll(); continue; }
    const tok = raw.match(/^\u0000(\d+)\u0000$/);
    if (tok) { closeAll(); html += tokens[+tok[1]] + '\n'; continue; }
    const h = raw.match(/^(#{1,6})\s+(.*)/);
    if (h) { closeAll(); const lvl = h[1].length; html += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; continue; }
    const q = raw.match(/^>\s?(.*)/);
    if (q) { closePara(); closeList(); if (open !== 'quote') { html += '<blockquote>'; open = 'quote'; } html += inline(q[1]) + '<br>'; continue; }
    const ul = raw.match(/^[-*]\s+(.*)/);
    if (ul) { closePara(); closeQuote(); if (open !== 'ul') { if (open === 'ol') html += '</ol>'; html += '<ul>'; open = 'ul'; } html += '<li>' + inline(ul[1]) + '</li>'; continue; }
    const ol = raw.match(/^(\d+)[.)]\s+(.*)/);
    if (ol) { closePara(); closeQuote(); if (open !== 'ol') { if (open === 'ul') html += '</ol>'; html += '<ol>'; open = 'ol'; } html += '<li>' + inline(ol[2]) + '</li>'; continue; }
    para.push(raw);
  }
  closeAll();
  return html;
}

function addMessage(role, text, isError) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble' + (isError ? ' error' : '');
  if (role === 'ai' && !isError) bubble.innerHTML = renderMarkdown(text);
  else bubble.textContent = text;
  wrap.appendChild(bubble);
  elements.aiChatContainer.appendChild(wrap);
  scrollBottom();
  return wrap;
}

function scrollBottom() {
  const c = elements.aiChatContainer;
  if (!c) return;
  const nearBottom = c.scrollHeight - (c.scrollTop + c.clientHeight) < 140;
  requestAnimationFrame(() => { if (nearBottom) c.scrollTop = c.scrollHeight; });
}

function typingIndicator() {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai';
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  const t = document.createElement('span');
  t.className = 'typing';
  for (let i = 0; i < 3; i++) t.appendChild(document.createElement('i'));
  bubble.appendChild(t);
  wrap.appendChild(bubble);
  elements.aiChatContainer.appendChild(wrap);
  scrollBottom();
  return () => wrap.remove();
}

function setBusy(on) {
  state.busy = on;
  if (elements.aiSendBtn) elements.aiSendBtn.disabled = on;
  if (elements.aiPromptInput) elements.aiPromptInput.disabled = on;
  if (elements.aiSendBtn) elements.aiSendBtn.classList.toggle('busy', on);
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
  if (elements.aiModeBygga) elements.aiModeBygga.classList.toggle('active', mode === 'build');
  if (elements.aiModePlaner) elements.aiModePlaner.classList.toggle('active', mode === 'plan');
  openChat();
}

function openChat() {
  if (elements.aiEmptyState) elements.aiEmptyState.classList.toggle('show', state.history.length === 0);
  const modeLabel = state.mode === 'plan' ? 'Planera · ' : '';
  if (elements.aiInputHint) {
    elements.aiInputHint.textContent = state.settings
      ? modeLabel + 'Modell · ' + state.settings.model
      : 'Ange API-nyckel i inställningarna för att börja';
  }
  scrollBottom();
}

async function sendPrompt(text) {
  if (!text || state.busy) return;
  if (!state.settings || !state.settings.key) {
    toast('Ange API-nyckel i inställningarna först');
    openSheet();
    return;
  }
  if (!state.currentFile) {
    toast('Ingen fil vald — öppna en fil först');
    return;
  }

  elements.aiPromptInput.value = '';
  elements.aiEmptyState.classList.remove('show');
  addMessage('user', text);
  const removeDots = typingIndicator();
  setBusy(true);

  try {
    const isPlan = state.mode === 'plan';
    const fileContext = "// Fil: " + state.currentFile + "\n" +
      (await window.AiProffsStorage.readFile(state.currentProjectId, state.currentFile) || '');

    const userMessage = isPlan
      ? text
      : (text + "\n\n--- Nuvarande fil (" + state.currentFile + ") ---\n" + fileContext);

    if (isPlan) {
      const { text: reply, model } = await callAiText(state.history, userMessage, state.settings.key, state.settings.model);
      state.history.push({ role: 'user', content: text });
      state.history.push({ role: 'model', content: reply, kind: 'text' });
      if (state.history.length > 40) state.history = state.history.slice(-40);
      commitSession();

      removeDots();
      if (model !== state.settings.model) {
        addMessage('ai', 'ℹ️ "' + state.settings.model + '" var överbelastad — svarade med "' + model + '" istället.');
      }
      addPlanReply(reply);
    } else {
      const { code, model } = await callAi(state.history, userMessage, state.settings.key, state.settings.model);
      state.history.push({ role: 'user', content: text });
      state.history.push({ role: 'model', content: code });
      if (state.history.length > 40) state.history = state.history.slice(-40);
      commitSession();

      removeDots();
      if (model !== state.settings.model) {
        addMessage('ai', 'ℹ️ "' + state.settings.model + '" var överbelastad — svarade med "' + model + '" istället.');
      }
      if (code && code.trim()) {
        await applyCodeToEditor(code);
        toast('Kod tillämpad på ' + state.currentFile);
      }
    }
  } catch (err) {
    removeDots();
    addMessage('ai', err.message, true);
  } finally {
    setBusy(false);
    if (elements.aiPromptInput) elements.aiPromptInput.focus();
  }
}

function addPlanReply(reply) {
  const wrap = addMessage('ai', reply);
  const bubble = wrap.querySelector('.ai-bubble');
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'ai-build-chip';
  chip.innerHTML = 'Bygg det här <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  chip.addEventListener('click', () => {
    setMode('build');
    toast('Byggläge — beskriv vad jag ska bygga');
    if (elements.aiPromptInput) elements.aiPromptInput.focus();
  });
  bubble.appendChild(chip);
}

async function applyCodeToEditor(code) {
  if (!window.AiProffsEditor || !state.currentFile) return;
  const view = window.AiProffsEditor.currentView();
  if (!view) return;
  window.AiProffsEditor.setContent(view, code);
  await window.AiProffsStorage.saveFile(state.currentProjectId, state.currentFile, code);
  if (window.AiProffsGit) {
    await window.AiProffsGit.commitAll(state.currentProjectId, "AI-redigering: " + state.currentFile, [state.currentFile]);
  }
}

function openSheet() {
  elements.aiSettingsSheet.classList.add('open');
  elements.aiSettingsSheet.setAttribute('aria-hidden', 'false');
  ensureModelsLoaded();
}
function closeSheet() {
  elements.aiSettingsSheet.classList.remove('open');
  elements.aiSettingsSheet.setAttribute('aria-hidden', 'true');
}

function fillSettings() {
  const s = loadSettings();
  if (s.key) {
    elements.aiApiKey.value = s.key;
    populateModels(false);
  }
}

async function saveSession() {
  const key = elements.aiApiKey.value.trim();
  if (!key) { toast('Fyll i din API-nyckel'); elements.aiApiKey.focus(); return; }
  elements.aiStartBtn.disabled = true;
  elements.aiStartBtn.textContent = 'Hämtar modeller…';
  try { await ensureModelsLoaded(); } catch (_) {}
  elements.aiStartBtn.disabled = false;
  elements.aiStartBtn.textContent = 'Spara & börja bygga';

  const model = elements.aiModelSelect.value === 'custom'
    ? (elements.aiCustomModel.value.trim() || 'gemini-2.5-flash')
    : (elements.aiModelSelect.value || elements.aiCustomModel.value.trim() || 'gemini-2.5-flash');

  state.settings = initSettings(key, model);
  updateModelChip();
  closeSheet();
  openChat();
  toast('Redo att bygga ✨');
  if (elements.aiPromptInput) elements.aiPromptInput.focus();
}

async function populateModels(force) {
  const key = elements.aiApiKey.value.trim();
  if (!key) { elements.aiModelHint.textContent = ''; return; }
  try {
    elements.aiModelHint.className = 'ai-hint';
    elements.aiModelHint.textContent = 'Hämtar modelllista…';
    const models = await listModels(key, force);
    const savedModel = elements.aiModelSelect.value === 'custom' ? elements.aiCustomModel.value.trim() : null;

    elements.aiModelSelect.innerHTML = '';
    if (!models.length) {
      elements.aiModelSelect.innerHTML = '<option value="">Inga modeller hittades</option>';
      elements.aiModelHint.textContent = '';
      return;
    }
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      elements.aiModelSelect.appendChild(opt);
    });
    const cust = document.createElement('option');
    cust.value = 'custom'; cust.textContent = 'Eget modell-ID…';
    elements.aiModelSelect.appendChild(cust);

    if (savedModel) {
      const found = models.indexOf(savedModel) !== -1;
      if (found) elements.aiModelSelect.value = savedModel;
      else { elements.aiModelSelect.value = 'custom'; elements.aiCustomModel.value = savedModel; }
    } else {
      elements.aiModelSelect.value = models.indexOf('gemini-2.5-flash') !== -1 ? 'gemini-2.5-flash' : models[0];
    }
    syncCustomField();
    elements.aiModelHint.textContent = models.length + ' modeller tillgängliga';
  } catch (e) {
    elements.aiModelHint.className = 'ai-hint error';
    elements.aiModelHint.textContent = 'Fel: ' + e.message;
  }
}

function syncCustomField() {
  const isCustom = elements.aiModelSelect.value === 'custom';
  elements.aiCustomModelGroup.classList.toggle('hidden', !isCustom);
  elements.aiCustomModel.disabled = !isCustom;
}

async function ensureModelsLoaded() {
  const key = elements.aiApiKey.value.trim();
  if (!key || key.length <= 10) return false;
  const hasRealOptions = Array.from(elements.aiModelSelect.options).filter(o => o.value && o.value !== 'custom').length > 0;
  if (!hasRealOptions) await populateModels(false);
  return hasRealOptions || elements.aiModelSelect.options.length > 1;
}

function updateModelChip() {
  const m = state.settings && state.settings.model;
  if (elements.aiModelChipText) elements.aiModelChipText.textContent = m || 'Ingen modell';
  if (elements.aiModelChip) elements.aiModelChip.classList.toggle('ready', !!m);
}

function loadSessions() {
  try { state.sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY)) || []; }
  catch (_) { state.sessions = []; }
  if (!Array.isArray(state.sessions)) state.sessions = [];
}
function saveSessions() {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(state.sessions.slice(-50))); } catch (_) {}
}
function currentSession() {
  return state.sessions.find((s) => s.id === state.activeId) || null;
}
function commitSession() {
  const s = currentSession();
  if (!s) return;
  s.history = state.history.slice();
  s.updated = Date.now();
  saveSessions();
}
function createSession() {
  const fresh = { id: 's' + Date.now().toString(36), title: '', ts: Date.now(), updated: Date.now(), history: [] };
  state.sessions.push(fresh);
  state.activeId = fresh.id;
  localStorage.setItem(ACTIVE_KEY, fresh.id);
  state.history = [];
  clearChat();
  openChat();
  saveSessions();
  return fresh;
}
function clearChat() {
  elements.aiChatContainer.innerHTML = '';
  const fresh = elements.aiEmptyState.cloneNode(true);
  fresh.querySelectorAll('.ai-chip').forEach((chip) => {
    chip.addEventListener('click', () => sendPrompt(chip.dataset.prompt));
  });
  elements.aiEmptyState = fresh;
  elements.aiChatContainer.appendChild(fresh);
}

function openPanel() {
  elements.aiPanel.classList.add('open');
  elements.aiBtn.classList.add('active');
  if (!state.settings || !state.settings.key) openSheet();
  else openChat();
  if (elements.aiPromptInput) elements.aiPromptInput.focus();
}
function closePanel() {
  elements.aiPanel.classList.remove('open');
  elements.aiBtn.classList.remove('active');
}

async function setContext(projectId, fileName) {
  state.currentProjectId = projectId;
  state.currentFile = fileName;
  if (!state.activeId) createSession();
  state.history = currentSession().history.slice();
  renderHistory();
}

function renderHistory() {
  clearChat();
  let lastUser = '';
  state.history.forEach((m) => {
    if (m.role === 'user') { lastUser = m.content; addMessage('user', m.content); }
    else if (m.kind === 'text') addMessage('ai', m.content);
    else if (m.content && m.content.trim()) { /* code messages not rendered in history */ }
  });
}

function initAiPanel() {
  initElements();
  loadSessions();
  fillSettings();
  updateModelChip();
  const active = state.sessions.find((s) => s.id === localStorage.getItem(ACTIVE_KEY));
  if (active) { state.activeId = active.id; state.history = active.history.slice(); renderHistory(); }
  else createSession();

  elements.aiBtn.addEventListener('click', () => {
    if (elements.aiPanel.classList.contains('open')) closePanel();
    else openPanel();
  });
  elements.aiClose.addEventListener('click', closePanel);
  elements.aiModelChip.addEventListener('click', openSheet);
  elements.aiCloseSheet.addEventListener('click', closeSheet);
  elements.aiSettingsSheet.querySelectorAll('[data-close-sheet]').forEach((el) => el.addEventListener('click', closeSheet));
  elements.aiStartBtn.addEventListener('click', saveSession);
  elements.aiEyeBtn.addEventListener('click', () => {
    const isPass = elements.aiApiKey.type === 'password';
    elements.aiApiKey.type = isPass ? 'text' : 'password';
  });
  elements.aiRefreshModels.addEventListener('click', () => populateModels(true));
  elements.aiModelSelect.addEventListener('change', syncCustomField);
  elements.aiApiKey.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) saveSession(); });
  elements.aiApiKey.addEventListener('blur', () => { const key = elements.aiApiKey.value.trim(); if (key && key.length > 10) populateModels(false); });
  elements.aiModeBygga.addEventListener('click', () => setMode('build'));
  elements.aiModePlaner.addEventListener('click', () => setMode('plan'));
  elements.aiSendBtn.addEventListener('click', () => sendPrompt(elements.aiPromptInput.value.trim()));
  elements.aiPromptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendPrompt(elements.aiPromptInput.value.trim()); });
  elements.aiSuggestChips.querySelectorAll('.ai-chip').forEach((chip) => {
    chip.addEventListener('click', () => sendPrompt(chip.dataset.prompt));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  if (!loadSettings().key && !elements.aiPanel.classList.contains('open')) openSheet();

  window.initAiPanelContext = setContext;
}
window.initAiPanel = initAiPanel;