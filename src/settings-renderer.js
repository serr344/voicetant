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
const groqKeyLabel    = document.getElementById('groqKeyLabel');
const openaiKeyLabel  = document.getElementById('openaiKeyLabel');
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
const startupHintEl = document.getElementById('startupHint');

const testGroqKeyBtn   = document.getElementById('testGroqKeyBtn');
const testOpenaiKeyBtn = document.getElementById('testOpenaiKeyBtn');

// ── Label status helpers ─────────────────────────────────────────
function ensureInlineStatus(labelEl, statusId) {
  let statusEl = document.getElementById(statusId);
  if (statusEl) return statusEl;

  labelEl.classList.add('key-label-row');

  statusEl = document.createElement('span');
  statusEl.id = statusId;
  statusEl.className = 'inline-test-status';
  labelEl.appendChild(statusEl);

  return statusEl;
}

const groqInlineStatus   = ensureInlineStatus(groqKeyLabel, 'groqInlineStatus');
const openaiInlineStatus = ensureInlineStatus(openaiKeyLabel, 'openaiInlineStatus');

// ── Service toggle ───────────────────────────────────────────────
function applyService(service) {
  apiHintEl.innerHTML = API_HINTS[service] || '';

  if (service === 'groq') {
    groqKeyField.classList.remove('hidden');
    openaiKeyField.classList.add('hidden');
    groqOpts.classList.remove('hidden');
    openaiOpts.classList.add('hidden');

    if (OPENAI_MODELS.includes(llmModelEl.value)) {
      llmModelEl.value = GROQ_MODELS[0];
    }
  } else {
    groqKeyField.classList.add('hidden');
    openaiKeyField.classList.remove('hidden');
    groqOpts.classList.add('hidden');
    openaiOpts.classList.remove('hidden');

    if (GROQ_MODELS.includes(llmModelEl.value)) {
      llmModelEl.value = OPENAI_MODELS[0];
    }
  }

  clearAllInlineStatuses();
}

apiServiceEl.addEventListener('change', () => applyService(apiServiceEl.value));

// ── Load settings ────────────────────────────────────────────────
async function loadSettings() {
  const raw = await window.voicetant.getSettings();
  const s   = { ...DEFAULT_SETTINGS, ...raw };

  apiServiceEl.value    = s.apiService || 'groq';
  groqKeyEl.value       = s.groqKey || '';
  openaiKeyEl.value     = s.openaiKey || '';
  llmModelEl.value      = s.llmModel || DEFAULT_SETTINGS.llmModel;
  systemPromptEl.value  = s.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
  ttsRateEl.value       = s.ttsRate ?? 1.0;
  rateValEl.textContent = Number(ttsRateEl.value).toFixed(1);
  launchEl.checked      = s.launchAtStartup ?? false;

  applyService(apiServiceEl.value);
}

// ── Helpers ──────────────────────────────────────────────────────
function mapTestResultToLabel(errorCode) {
  switch (errorCode) {
    case 'missing_api_key':
      return 'NO KEY';
    case 'invalid_api_key':
      return 'BAD KEY';
    case 'model_not_found':
      return 'BAD MODEL';
    case 'rate_limit':
      return 'LIMIT';
    case 'network_error':
      return 'NETWORK';
    case 'timeout':
      return 'TIMEOUT';
    case 'forbidden':
      return 'DENIED';
    case 'server_error':
      return 'SERVER';
    default:
      return 'ERROR';
  }
}

async function loadEnvironmentInfo() {
  try {
    const env = await window.voicetant.getAppEnvironment();

    if (env && env.isPackaged === false) {
      startupHintEl.classList.remove('hidden');
    } else {
      startupHintEl.classList.add('hidden');
    }
  } catch (err) {
    console.error('[settings] Failed to load environment info:', err);
  }
}

function setInlineStatus(el, type, text) {
  if (!el) return;
  el.textContent = text ? `- ${text}` : '';
  el.classList.remove('success', 'error', 'pending');
  if (type) el.classList.add(type);
}

function clearAllInlineStatuses() {
  setInlineStatus(groqInlineStatus, '', '');
  setInlineStatus(openaiInlineStatus, '', '');
}

function getActiveProviderContext() {
  const service = apiServiceEl.value;
  const isGroq = service === 'groq';

  return {
    service,
    inputEl: isGroq ? groqKeyEl : openaiKeyEl,
    buttonEl: isGroq ? testGroqKeyBtn : testOpenaiKeyBtn,
    statusEl: isGroq ? groqInlineStatus : openaiInlineStatus,
  };
}

function validateSettingsBeforeSave() {
  clearAllInlineStatuses();

  const { service, inputEl, statusEl } = getActiveProviderContext();
  const key = inputEl.value.trim();

  if (!key) {
    setInlineStatus(statusEl, 'error', 'NO KEY');
    return { ok: false, field: service === 'groq' ? 'groqKey' : 'openaiKey' };
  }

  return { ok: true };
}

function setSaveButtonInvalidState() {
  const originalText = saveBtn.textContent;
  const originalBorder = saveBtn.style.borderColor;
  const originalColor = saveBtn.style.color;
  const originalShadow = saveBtn.style.boxShadow;
  const originalBackground = saveBtn.style.background;

  saveBtn.textContent = 'INVALID';
  saveBtn.disabled = true;
  saveBtn.style.borderColor = '#ff4d6d';
  saveBtn.style.color = '#ff4d6d';
  saveBtn.style.boxShadow = '0 0 10px rgba(255,77,109,0.25)';
  saveBtn.style.background = 'rgba(32, 10, 16, 0.98)';

  setTimeout(() => {
    saveBtn.textContent = originalText;
    saveBtn.disabled = false;
    saveBtn.style.borderColor = originalBorder;
    saveBtn.style.color = originalColor;
    saveBtn.style.boxShadow = originalShadow;
    saveBtn.style.background = originalBackground;
  }, 1200);
}

async function runProviderKeyTest(provider, { silent = false } = {}) {
  const isGroq = provider === 'groq';
  const button = isGroq ? testGroqKeyBtn : testOpenaiKeyBtn;
  const status = isGroq ? groqInlineStatus : openaiInlineStatus;

  const originalText = button?.textContent || 'CHECK';

  if (button && !silent) {
    button.disabled = true;
    button.textContent = '...';
  }

  if (!silent) {
    setInlineStatus(status, 'pending', 'CHECKING');
  }

  try {
    const result = await window.voicetant.testApiKey({
      apiService: provider,
      groqKey: groqKeyEl.value.trim(),
      openaiKey: openaiKeyEl.value.trim(),
      llmModel: llmModelEl.value,
    });

    if (result?.ok) {
      setInlineStatus(status, 'success', 'VALID KEY');
    } else {
      setInlineStatus(status, 'error', mapTestResultToLabel(result?.error));
    }

    return result;
  } catch (err) {
    console.error('[settings] provider key test failed:', err);
    setInlineStatus(status, 'error', 'ERROR');
    return { ok: false, error: 'unknown_error' };
  } finally {
    if (button && !silent) {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
      }, 1000);
    }
  }
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

saveBtn.addEventListener('click', saveSettings);
cancelBtn.addEventListener('click', () => window.voicetant.closeSettings());
closeBtn.addEventListener('click', () => window.voicetant.closeSettings());

clearConversationBtn.addEventListener('click', async () => {
  await window.voicetant.clearConversation();
});

if (testGroqKeyBtn) {
  testGroqKeyBtn.addEventListener('click', async () => {
    await runProviderKeyTest('groq');
  });
}

if (testOpenaiKeyBtn) {
  testOpenaiKeyBtn.addEventListener('click', async () => {
    await runProviderKeyTest('openai');
  });
}

groqKeyEl.addEventListener('input', () => setInlineStatus(groqInlineStatus, '', ''));
openaiKeyEl.addEventListener('input', () => setInlineStatus(openaiInlineStatus, '', ''));
llmModelEl.addEventListener('change', clearAllInlineStatuses);
apiServiceEl.addEventListener('change', clearAllInlineStatuses);

loadSettings();
loadEnvironmentInfo();