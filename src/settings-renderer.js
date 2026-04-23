// settings-renderer.js

const DEFAULT_SETTINGS = {
  apiService:      'groq',
  groqKey:         '',
  openaiKey:       '',
  llmModel:        'llama-3.3-70b-versatile',
  systemPrompt:    'You are Voicetant, a fast and concise voice assistant. Always respond in English. Keep answers under 3 sentences. No markdown, no bullet points — plain spoken text only.',
  ttsRate:         1.0,
  launchAtStartup: false,
};

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-groq-70b-8192-tool-use-preview',
  'gemma2-9b-it',
];

const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];

const API_HINTS = {
  groq:   'Get your free key at <b>console.groq.com</b>',
  openai: 'Get your key at <b>platform.openai.com/api-keys</b>',
};

// ── Elements ─────────────────────────────────────────────────────
const apiServiceEl    = document.getElementById('apiService');
const apiHintEl       = document.getElementById('apiHint');
const groqKeyField    = document.getElementById('groqKeyField');
const openaiKeyField  = document.getElementById('openaiKeyField');
const groqKeyEl       = document.getElementById('groqKey');
const openaiKeyEl     = document.getElementById('openaiKey');
const llmModelEl      = document.getElementById('llmModel');
const groqOpts        = document.querySelector('.groq-opts');
const openaiOpts      = document.querySelector('.openai-opts');
const systemPromptEl  = document.getElementById('systemPrompt');
const ttsRateEl       = document.getElementById('ttsRate');
const rateValEl       = document.getElementById('rateVal');
const launchEl        = document.getElementById('launchAtStartup');
const saveBtn         = document.getElementById('saveBtn');
const cancelBtn       = document.getElementById('cancelBtn');
const closeBtn        = document.getElementById('closeBtn');
const clearConversationBtn = document.getElementById('clearConversationBtn');

// ── Service toggle ───────────────────────────────────────────────
function applyService(service) {
  apiHintEl.innerHTML = API_HINTS[service] || '';

  if (service === 'groq') {
    groqKeyField.classList.remove('hidden');
    openaiKeyField.classList.add('hidden');
    groqOpts.classList.remove('hidden');
    openaiOpts.classList.add('hidden');
    // Select first groq model if current is openai
    if (OPENAI_MODELS.includes(llmModelEl.value)) {
      llmModelEl.value = GROQ_MODELS[0];
    }
  } else {
    groqKeyField.classList.add('hidden');
    openaiKeyField.classList.remove('hidden');
    groqOpts.classList.add('hidden');
    openaiOpts.classList.remove('hidden');
    // Select first openai model if current is groq
    if (GROQ_MODELS.includes(llmModelEl.value)) {
      llmModelEl.value = OPENAI_MODELS[0];
    }
  }
}

apiServiceEl.addEventListener('change', () => applyService(apiServiceEl.value));

// ── Load settings ────────────────────────────────────────────────
async function loadSettings() {
  const raw = await window.voicetant.getSettings();
  const s   = { ...DEFAULT_SETTINGS, ...raw };

  apiServiceEl.value   = s.apiService   || 'groq';
  groqKeyEl.value      = s.groqKey      || '';
  openaiKeyEl.value    = s.openaiKey    || '';
  llmModelEl.value     = s.llmModel     || DEFAULT_SETTINGS.llmModel;
  systemPromptEl.value = s.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
  ttsRateEl.value      = s.ttsRate      ?? 1.0;
  rateValEl.textContent = Number(ttsRateEl.value).toFixed(1);
  launchEl.checked     = s.launchAtStartup ?? false;

  applyService(apiServiceEl.value);
}

// ── Save ─────────────────────────────────────────────────────────
async function saveSettings() {
  const settings = {
    apiService:      apiServiceEl.value,
    groqKey:         groqKeyEl.value.trim(),
    openaiKey:       openaiKeyEl.value.trim(),
    llmModel:        llmModelEl.value,
    systemPrompt:    systemPromptEl.value.trim() || DEFAULT_SETTINGS.systemPrompt,
    ttsRate:         parseFloat(ttsRateEl.value),
    launchAtStartup: launchEl.checked,
  };

  await window.voicetant.saveSettings(settings);
  window.voicetant.closeSettings();
}

// ── Events ───────────────────────────────────────────────────────
ttsRateEl.addEventListener('input', () => {
  rateValEl.textContent = Number(ttsRateEl.value).toFixed(1);
});

// Show/hide toggle buttons
document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input    = document.getElementById(targetId);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'HIDE';
    } else {
      input.type = 'password';
      btn.textContent = 'SHOW';
    }
  });
});

saveBtn.addEventListener('click', saveSettings);
cancelBtn.addEventListener('click', () => window.voicetant.closeSettings());
closeBtn.addEventListener('click', () => window.voicetant.closeSettings());

clearConversationBtn.addEventListener('click', async () => {
  await window.voicetant.clearConversation();
  window.voicetant.closeSettings();
});

loadSettings();