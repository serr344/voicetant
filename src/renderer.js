// renderer.js — microphone + Whisper STT + LLM + TTS + Settings

const listenBtn   = document.querySelector('.listen-btn');
const statusDot   = document.querySelector('.status-dot');
const settingsBtn = document.querySelector('.settings-btn');

let settingsWarningEl = null;

let mediaRecorder = null;
let audioChunks   = [];
let stream        = null;
let isRecording   = false;
let savedMimeType = '';
let isSpeaking    = false;

// ── Recording guards ─────────────────────────────────────────────
const MAX_RECORDING_MS = 15000;
const MIN_RECORDING_MS = 700;
const MIN_AUDIO_BYTES  = 3072;

let recordingStartTime = 0;
let recordingTimer     = null;

// ── Conversation history ─────────────────────────────────────────
let systemPrompt =
  'You are Voicetant, a fast and concise voice assistant. ' +
  'Always respond in English. Keep answers under 3 sentences. ' +
  'No markdown, no bullet points — plain spoken text only.';

function buildHistory() {
  return [{ role: 'system', content: systemPrompt }];
}

let conversationHistory = buildHistory();
const MAX_HISTORY_PAIRS = 8;

// ── Apply settings ───────────────────────────────────────────────
async function applySettings(s) {
  if (s && s.systemPrompt) {
    systemPrompt = s.systemPrompt;
    conversationHistory = buildHistory();
  }
}

window.voicetant.getSettings().then(applySettings);
window.voicetant.onSettingsUpdated(applySettings);
window.voicetant.onConversationCleared(() => {
  clearConversationHistory();
});

// ── Helpers ──────────────────────────────────────────────────────
function clearRecordingTimer() {
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }
}

function cleanupRecordingResources() {
  clearRecordingTimer();

  if (stream) {
    try {
      stream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    stream = null;
  }

  mediaRecorder = null;
  isRecording = false;
}

function resetRecordingState() {
  audioChunks = [];
  savedMimeType = '';
  recordingStartTime = 0;
  isRecording = false;
}

function getRecordingDurationMs() {
  if (!recordingStartTime) return 0;
  return Date.now() - recordingStartTime;
}

function normalizeTranscript(text) {
  return String(text || '').trim();
}

function isMeaninglessTranscript(text) {
  const t = normalizeTranscript(text);

  if (!t) return true;

  const withoutPunctuation = t.replace(/[\p{P}\p{S}\s]+/gu, '');
  if (!withoutPunctuation) return true;

  if (t.length <= 3 && !/[a-zA-Z0-9]/.test(t)) return true;

  return false;
}

function mapErrorToUi(errorCode) {
  switch (errorCode) {
    case 'missing_api_key':
      return 'NO KEY';
    case 'invalid_api_key':
      return 'BAD KEY';
    case 'rate_limit':
      return 'LIMIT';
    case 'network_error':
      return 'NETWORK';
    case 'timeout':
      return 'TIMEOUT';
    case 'invalid_media':
      return 'BAD AUDIO';
    case 'audio_file_not_found':
      return 'NO FILE';
    case 'model_not_found':
      return 'BAD MODEL';
    case 'file_too_large':
      return 'TOO BIG';
    case 'forbidden':
      return 'DENIED';
    case 'not_found':
      return 'NOT FOUND';
    case 'bad_request':
      return 'BAD REQ';
    case 'server_error':
      return 'SERVER';
    case 'save_failed':
      return 'SAVE ERR';
    case 'unknown_error':
    default:
      return 'ERROR';
  }
}

function trimConversationHistory() {
  const systemMessage = conversationHistory[0];
  const rest = conversationHistory.slice(1);

  const maxMessages = MAX_HISTORY_PAIRS * 2;
  const trimmed = rest.slice(-maxMessages);

  conversationHistory = [systemMessage, ...trimmed];
}

function clearConversationHistory() {
  conversationHistory = buildHistory();
  console.log('[renderer] Conversation history cleared.');
}

function expandAbbreviationsForTts(text) {
  return String(text || '')
    .replace(/\bAPI\b/g, 'A P I')
    .replace(/\bUI\b/g, 'U I')
    .replace(/\bURL\b/g, 'U R L')
    .replace(/\bLLM\b/g, 'L L M')
    .replace(/\bTTS\b/g, 'T T S')
    .replace(/\bSTT\b/g, 'S T T')
    .replace(/\bCPU\b/g, 'C P U')
    .replace(/\bGPU\b/g, 'G P U')
    .replace(/\bRAM\b/g, 'R A M')
    .replace(/\bHTML\b/g, 'H T M L')
    .replace(/\bCSS\b/g, 'C S S')
    .replace(/\bJS\b/g, 'J S')
    .replace(/\bJSON\b/g, 'J S O N')
    .replace(/\bSQL\b/g, 'S Q L')
    .replace(/\bnpm\b/gi, 'N P M')
    .replace(/\bVS Code\b/gi, 'V S Code');
}

function sanitizeTextForTts(text) {
  let cleaned = String(text || '');

  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' code snippet omitted ');
  cleaned = cleaned.replace(/`([^`]*)`/g, '$1');

  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');
  cleaned = cleaned.replace(/__(.*?)__/g, '$1');
  cleaned = cleaned.replace(/_(.*?)_/g, '$1');
  cleaned = cleaned.replace(/~~(.*?)~~/g, '$1');

  cleaned = cleaned.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  cleaned = cleaned.replace(/^\s{0,3}>\s?/gm, '');

  cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1');
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, 'this link');
  cleaned = cleaned.replace(/www\.\S+/gi, 'this link');

  cleaned = cleaned.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'this email address');

  cleaned = cleaned.replace(/[<>[\]{}]+/g, ' ');
  cleaned = cleaned.replace(/[—–]+/g, ' - ');
  cleaned = cleaned.replace(/\|/g, ', ');
  cleaned = cleaned.replace(/\\/g, ' ');
  cleaned = cleaned.replace(/\s\/\s/g, ' or ');

  cleaned = cleaned.replace(/^\s*[-*•]+\s+/gm, '');
  cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, '');
  cleaned = cleaned.replace(/\((?:this link|https?:\/\/[^\)]*|www\.[^\)]*)\)/gi, '');

  cleaned = cleaned.replace(/[\p{Extended_Pictographic}]/gu, '');

  cleaned = cleaned.replace(/\.{4,}/g, '...');
  cleaned = cleaned.replace(/!{2,}/g, '!');
  cleaned = cleaned.replace(/\?{2,}/g, '?');
  cleaned = cleaned.replace(/,{2,}/g, ',');
  cleaned = cleaned.replace(/;{2,}/g, ';');
  cleaned = cleaned.replace(/:{2,}/g, ':');

  cleaned = cleaned.replace(/\s+([,.;:!?])/g, '$1');
  cleaned = cleaned.replace(/([,.;:!?])([^\s])/g, '$1 $2');

  cleaned = cleaned.replace(/-{2,}/g, '-');
  cleaned = cleaned.replace(/[@#$%^&*_+=~]+/g, ' ');
  cleaned = cleaned.replace(/\s*\n+\s*/g, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  cleaned = expandAbbreviationsForTts(cleaned);

  const MAX_TTS_CHARS = 320;
  if (cleaned.length > MAX_TTS_CHARS) {
    const shortened = cleaned.slice(0, MAX_TTS_CHARS);

    const lastSentenceEnd = Math.max(
      shortened.lastIndexOf('.'),
      shortened.lastIndexOf('!'),
      shortened.lastIndexOf('?')
    );

    if (lastSentenceEnd > 120) {
      cleaned = shortened.slice(0, lastSentenceEnd + 1).trim();
    } else {
      const lastSpace = shortened.lastIndexOf(' ');
      cleaned = (lastSpace > 120 ? shortened.slice(0, lastSpace) : shortened).trim() + '.';
    }
  }

  return cleaned;
}

function ensureSettingsWarningEl() {
  if (settingsWarningEl) return settingsWarningEl;

  settingsWarningEl = document.createElement('div');
  settingsWarningEl.textContent = '';
  settingsWarningEl.style.position = 'absolute';
  settingsWarningEl.style.right = '14px';
  settingsWarningEl.style.top = '50%';
  settingsWarningEl.style.transform = 'translateY(-50%)';
  settingsWarningEl.style.minWidth = '112px';
  settingsWarningEl.style.height = '30px';
  settingsWarningEl.style.padding = '0 12px';
  settingsWarningEl.style.display = 'flex';
  settingsWarningEl.style.alignItems = 'center';
  settingsWarningEl.style.justifyContent = 'center';
  settingsWarningEl.style.border = '1.5px solid #ff4d6d';
  settingsWarningEl.style.background = 'rgba(32, 10, 16, 0.98)';
  settingsWarningEl.style.color = '#ff4d6d';
  settingsWarningEl.style.fontFamily = "'Press Start 2P', cursive";
  settingsWarningEl.style.fontSize = '7px';
  settingsWarningEl.style.letterSpacing = '0.4px';
  settingsWarningEl.style.boxShadow = '0 0 6px rgba(255,77,109,0.22)';
  settingsWarningEl.style.pointerEvents = 'none';
  settingsWarningEl.style.opacity = '0';
  settingsWarningEl.style.transition = 'opacity 0.15s ease';
  settingsWarningEl.style.zIndex = '5';

  const frame = document.querySelector('.frame');
  frame.appendChild(settingsWarningEl);

  return settingsWarningEl;
}

function showSettingsWarning(text) {
  const el = ensureSettingsWarningEl();

  el.textContent = text;
  listenBtn.style.visibility = 'hidden';
  el.style.opacity = '1';

  clearTimeout(showSettingsWarning._timer);
  showSettingsWarning._timer = setTimeout(() => {
    el.style.opacity = '0';
    listenBtn.style.visibility = 'visible';
  }, 1800);
}

function isLikelyValidKeyFormat(service, key) {
  const trimmed = String(key || '').trim();

  if (!trimmed) return false;

  if (service === 'groq') {
    return trimmed.startsWith('gsk_');
  }

  if (service === 'openai') {
    return trimmed.startsWith('sk-');
  }

  return false;
}

async function precheckBeforeSpeak() {
  const s = await window.voicetant.getSettings();
  const service = s?.apiService || 'groq';
  const key = service === 'openai' ? s?.openaiKey : s?.groqKey;

  if (!String(key || '').trim()) {
    showSettingsWarning('NO KEY');
    return { ok: false, reason: 'missing_api_key' };
  }

  if (!isLikelyValidKeyFormat(service, key)) {
    showSettingsWarning('BAD KEY');
    return { ok: false, reason: 'invalid_api_key' };
  }

  return { ok: true };
}

function updateRecordingButtonLabel() {
  if (!isRecording) return;

  const isHover = listenBtn.matches(':hover');

  if (isHover) {
    listenBtn.textContent       = 'STOP';
    listenBtn.style.borderColor = '#ff4d6d';
    listenBtn.style.color       = '#ff4d6d';
    listenBtn.style.boxShadow   = '0 0 6px rgba(255,77,109,0.22)';

    statusDot.style.background  = '#ff4d6d';
    statusDot.style.boxShadow   = '0 0 6px rgba(255,77,109,0.45)';
  } else {
    listenBtn.textContent       = 'LISTENING';
    listenBtn.style.borderColor = 'var(--cyan)';
    listenBtn.style.color       = 'var(--cyan)';
    listenBtn.style.boxShadow   = '0 0 6px rgba(30,200,255,0.18)';

    statusDot.style.background  = 'var(--cyan)';
    statusDot.style.boxShadow   = '0 0 6px rgba(30,200,255,0.45)';
  }
}

// ── State machine ────────────────────────────────────────────────
const STATE = {
  idle: () => {
    statusDot.style.background  = 'var(--green)';
    statusDot.style.boxShadow   = '0 0 4px rgba(68,255,154,0.22)';
    listenBtn.textContent       = 'SPEAK';
    listenBtn.style.borderColor = 'var(--green)';
    listenBtn.style.color       = 'var(--green)';
    listenBtn.style.boxShadow   = '0 0 4px rgba(68,255,154,0.12)';
    listenBtn.disabled          = false;
    listenBtn.style.visibility  = 'visible';
    if (settingsWarningEl) settingsWarningEl.style.opacity = '0';
  },
  recording: () => {
    listenBtn.disabled = false;
    updateRecordingButtonLabel();
  },
  transcribing: () => {
    statusDot.style.background  = '#8b4dff';
    statusDot.style.boxShadow   = '0 0 6px rgba(139,77,255,0.5)';
    listenBtn.textContent       = 'THINK';
    listenBtn.style.borderColor = '#8b4dff';
    listenBtn.style.color       = '#8b4dff';
    listenBtn.style.boxShadow   = '0 0 6px rgba(139,77,255,0.2)';
    listenBtn.disabled          = true;
  },
  thinking: () => {
    statusDot.style.background  = '#8b4dff';
    statusDot.style.boxShadow   = '0 0 6px rgba(139,77,255,0.5)';
    listenBtn.textContent       = 'THINK';
    listenBtn.style.borderColor = '#8b4dff';
    listenBtn.style.color       = '#8b4dff';
    listenBtn.style.boxShadow   = '0 0 6px rgba(139,77,255,0.2)';
    listenBtn.disabled          = true;
  },
  speaking: () => {
    statusDot.style.background  = '#ffb347';
    statusDot.style.boxShadow   = '0 0 6px rgba(255,179,71,0.5)';
    listenBtn.textContent       = 'SKIP';
    listenBtn.style.borderColor = '#ffb347';
    listenBtn.style.color       = '#ffb347';
    listenBtn.style.boxShadow   = '0 0 6px rgba(255,179,71,0.2)';
    listenBtn.disabled          = false;
  },
  error: (msg = 'ERROR') => {
    statusDot.style.background  = '#ff4d6d';
    statusDot.style.boxShadow   = '0 0 6px rgba(255,77,109,0.5)';
    listenBtn.textContent       = msg.slice(0, 8).toUpperCase();
    listenBtn.style.borderColor = '#ff4d6d';
    listenBtn.style.color       = '#ff4d6d';
    listenBtn.style.boxShadow   = '0 0 6px rgba(255,77,109,0.18)';
    listenBtn.disabled          = false;
    console.error('[renderer] Error:', msg);
    setTimeout(STATE.idle, 2500);
  },
};

// ── TTS ──────────────────────────────────────────────────────────
function speak(text) {
  return new Promise((resolve) => {
    isSpeaking = true;
    STATE.speaking();

    window.voicetant.speak(text).then(() => {
      isSpeaking = false;
      STATE.idle();
      resolve();
    }).catch((err) => {
      console.error('[renderer] TTS error:', err);
      isSpeaking = false;
      STATE.idle();
      resolve();
    });
  });
}

function stopSpeaking() {
  window.voicetant.stopSpeak();
  isSpeaking = false;
  STATE.idle();
}

// ── Microphone ───────────────────────────────────────────────────
async function getMicStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    console.error('[renderer] Microphone access denied:', err.name);
    return null;
  }
}

// ── Start recording ──────────────────────────────────────────────
async function startRecording() {
  if (isRecording) return;

  stream = await getMicStream();
  if (!stream) {
    STATE.error('NO MIC');
    return;
  }

  audioChunks = [];

  const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', '']
    .find(t => t === '' || MediaRecorder.isTypeSupported(t));

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  savedMimeType = mediaRecorder.mimeType;

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = handleStop;

  mediaRecorder.start(250);
  isRecording = true;
  recordingStartTime = Date.now();

  clearRecordingTimer();
  recordingTimer = setTimeout(() => {
    if (isRecording) {
      console.log('[renderer] Max recording duration reached, stopping automatically.');
      stopRecording();
    }
  }, MAX_RECORDING_MS);

  STATE.recording();
  console.log('[renderer] Recording started — format:', savedMimeType);
}

// ── Stop recording ───────────────────────────────────────────────
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  clearRecordingTimer();

  const duration = getRecordingDurationMs();
  console.log(`[renderer] Recording duration: ${duration} ms`);

  if (duration < MIN_RECORDING_MS) {
    console.log('[renderer] Recording too short, cancelling.');

    try {
      mediaRecorder.onstop = null;
      mediaRecorder.stop();
    } catch (_) {}

    cleanupRecordingResources();
    resetRecordingState();
    STATE.error('TOO SHORT');
    return;
  }

  STATE.thinking();

  try {
    mediaRecorder.stop();
  } catch (err) {
    console.error('[renderer] Failed to stop recorder:', err);
    cleanupRecordingResources();
    resetRecordingState();
    STATE.error('STOP ERR');
  }
}

// ── Pipeline: STT → LLM → TTS ────────────────────────────────────
async function handleStop() {
  try {
    cleanupRecordingResources();

    if (audioChunks.length === 0) {
      console.log('[renderer] No audio chunks captured.');
      resetRecordingState();
      STATE.idle();
      return;
    }

    const blob = new Blob(audioChunks, { type: savedMimeType || 'audio/webm' });
    const arrayBuf = await blob.arrayBuffer();

    console.log('[renderer] Blob MIME:', blob.type || '(empty)');
    console.log(`[renderer] Recording size: ${(arrayBuf.byteLength / 1024).toFixed(1)} KB`);

    if (arrayBuf.byteLength < MIN_AUDIO_BYTES) {
      console.log('[renderer] Audio blob too small, cancelling.');
      resetRecordingState();
      STATE.error('NO VOICE');
      return;
    }

    const fileResult = await window.voicetant.saveAudio({
      buffer: arrayBuf,
      mimeType: savedMimeType || 'audio/webm',
    });

    if (!fileResult || !fileResult.filePath) {
      resetRecordingState();
      STATE.error(mapErrorToUi(fileResult?.error));
      return;
    }

    const filePath = fileResult.filePath;

    const sttResult = await window.voicetant.transcribeAudio(filePath);
    if (sttResult.error) {
      resetRecordingState();
      STATE.error(mapErrorToUi(sttResult.error));
      return;
    }

    const transcript = normalizeTranscript(sttResult.transcript);
    console.log('[renderer] Transcript:', transcript);

    if (isMeaninglessTranscript(transcript)) {
      console.log('[renderer] Transcript is empty / meaningless, cancelling.');
      resetRecordingState();
      STATE.error('NO VOICE');
      return;
    }

    STATE.thinking();
    conversationHistory.push({ role: 'user', content: transcript });
    trimConversationHistory();

    const llmResult = await window.voicetant.askLlm({ messages: conversationHistory });
    if (llmResult.error) {
      resetRecordingState();
      STATE.error(mapErrorToUi(llmResult.error));
      return;
    }

    const reply = llmResult.reply;
    conversationHistory.push({ role: 'assistant', content: reply });
    trimConversationHistory();
    console.log('[renderer] LLM reply:', reply);

    const ttsText = sanitizeTextForTts(reply);
    console.log('[renderer] TTS text:', ttsText);

    resetRecordingState();
    await speak(ttsText);

  } catch (err) {
    console.error('[renderer] Pipeline failed:', err);
    cleanupRecordingResources();
    resetRecordingState();
    STATE.error('PIPE ERR');
  }
}

// ── Buttons ──────────────────────────────────────────────────────
listenBtn.addEventListener('mouseenter', () => {
  updateRecordingButtonLabel();
});

listenBtn.addEventListener('mouseleave', () => {
  updateRecordingButtonLabel();
});

listenBtn.addEventListener('click', async () => {
  if (isSpeaking) {
    stopSpeaking();
    return;
  }

  if (isRecording) {
    stopRecording();
    return;
  }

  const precheck = await precheckBeforeSpeak();
  if (!precheck.ok) {
    return;
  }

  startRecording();
});

settingsBtn.addEventListener('click', () => {
  window.voicetant.openSettings();
});

STATE.idle();