// ————— ai.js —————
// Gemini-wrapper för C-kodgenerering i AiProffsSnickarn.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS_CACHE_KEY = 'AIPROFFS_AI_MODELS_CACHE';
const AI_KEY = 'AIPROFFS_AI_KEY';
const AI_MODEL = 'AIPROFFS_AI_MODEL';
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
  if (apiKey) localStorage.setItem(AI_KEY, apiKey);
  if (modelId) localStorage.setItem(AI_MODEL, modelId);
  return { key: localStorage.getItem(AI_KEY), model: localStorage.getItem(AI_MODEL) };
}

function loadSettings() {
  return { key: localStorage.getItem(AI_KEY), model: localStorage.getItem(AI_MODEL) };
}

function clearSettings() {
  localStorage.removeItem(AI_KEY);
  localStorage.removeItem(AI_MODEL);
}

// Expose globally
window.AiApi = {
  listModels,
  callAi,
  callAiText,
  initSettings,
  loadSettings,
  clearSettings,
  SYSTEM_PROMPT,
  PLAN_PROMPT,
  FALLBACKS
};