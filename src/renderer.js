// renderer.js — microphone + Whisper STT + LLM + TTS + Settings

const listenBtn   = document.querySelector('.listen-btn');
const statusDot   = document.querySelector('.status-dot');
const settingsBtn = document.querySelector('.settings-btn');

let mediaRecorder = null;
let audioChunks   = [];
let stream        = null;
let isRecording   = false;
let savedMimeType = '';
let isSpeaking    = false;

// ── Conversation history ─────────────────────────────────────────
let systemPrompt =
  'You are Voicetant, a fast and concise voice assistant. ' +
  'Always respond in English. Keep answers under 3 sentences. ' +
  'No markdown, no bullet points — plain spoken text only.';

function buildHistory() {
  return [{ role: 'system', content: systemPrompt }];
}

let conversationHistory = buildHistory();

// ── Apply settings ───────────────────────────────────────────────
async function applySettings(s) {
  if (s && s.systemPrompt) {
    systemPrompt = s.systemPrompt;
    conversationHistory = buildHistory();
  }
}

window.voicetant.getSettings().then(applySettings);
window.voicetant.onSettingsUpdated(applySettings);

// ── State machine ────────────────────────────────────────────────
const STATE = {
  idle: () => {
    statusDot.style.background  = 'var(--green)';
    statusDot.style.boxShadow   = '0 0 4px rgba(68,255,154,0.22)';
    listenBtn.textContent       = 'LISTEN';
    listenBtn.style.borderColor = 'var(--green)';
    listenBtn.style.color       = 'var(--green)';
    listenBtn.style.boxShadow   = '0 0 4px rgba(68,255,154,0.12)';
    listenBtn.disabled          = false;
  },
  recording: () => {
    statusDot.style.background  = '#ff4d6d';
    statusDot.style.boxShadow   = '0 0 6px rgba(255,77,109,0.5)';
    listenBtn.textContent       = 'STOP';
    listenBtn.style.borderColor = '#ff4d6d';
    listenBtn.style.color       = '#ff4d6d';
    listenBtn.style.boxShadow   = '0 0 6px rgba(255,77,109,0.2)';
    listenBtn.disabled          = false;
  },
  transcribing: () => {
    statusDot.style.background  = 'var(--cyan)';
    statusDot.style.boxShadow   = '0 0 6px rgba(30,200,255,0.4)';
    listenBtn.textContent       = 'STT...';
    listenBtn.style.borderColor = 'var(--cyan)';
    listenBtn.style.color       = 'var(--cyan)';
    listenBtn.style.boxShadow   = '0 0 6px rgba(30,200,255,0.15)';
    listenBtn.disabled          = true;
  },
  thinking: () => {
    statusDot.style.background  = '#8b4dff';
    statusDot.style.boxShadow   = '0 0 6px rgba(139,77,255,0.5)';
    listenBtn.textContent       = 'LLM...';
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
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (err) {
    console.error('[renderer] Microphone access denied:', err.name);
    return null;
  }
}

// ── Start recording ──────────────────────────────────────────────
async function startRecording() {
  stream = await getMicStream();
  if (!stream) { STATE.error('NO MIC'); return; }

  audioChunks = [];
  const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', '']
    .find(t => t === '' || MediaRecorder.isTypeSupported(t));

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  savedMimeType = mediaRecorder.mimeType;
  mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunks.push(e.data); };
  mediaRecorder.onstop = handleStop;
  mediaRecorder.start(250);
  isRecording = true;
  STATE.recording();
  console.log('[renderer] Recording started — format:', savedMimeType);
}

// ── Stop recording ───────────────────────────────────────────────
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  STATE.transcribing();
  mediaRecorder.stop();
  stream.getTracks().forEach(t => t.stop());
  isRecording = false;
}

// ── Pipeline: STT → LLM → TTS ────────────────────────────────────
async function handleStop() {
  if (audioChunks.length === 0) { STATE.idle(); return; }

  const blob     = new Blob(audioChunks, { type: savedMimeType || 'audio/webm' });
  const arrayBuf = await blob.arrayBuffer();
  console.log(`[renderer] Recording size: ${(arrayBuf.byteLength / 1024).toFixed(1)} KB`);

  // 1) Save
  const filePath = await window.voicetant.saveAudio(arrayBuf);
  if (!filePath) { STATE.error('SAVE ERR'); return; }

  // 2) STT
  const sttResult = await window.voicetant.transcribeAudio(filePath);
  if (sttResult.error) { STATE.error('STT ERR'); return; }
  const transcript = sttResult.transcript;
  console.log('[renderer] Transcript:', transcript);
  if (!transcript) { STATE.idle(); return; }

  // 3) LLM
  STATE.thinking();
  conversationHistory.push({ role: 'user', content: transcript });
  const llmResult = await window.voicetant.askLlm({ messages: conversationHistory });
  if (llmResult.error) { STATE.error('LLM ERR'); return; }
  const reply = llmResult.reply;
  conversationHistory.push({ role: 'assistant', content: reply });
  console.log('[renderer] LLM reply:', reply);

  // 4) TTS
  await speak(reply);
}

// ── Buttons ──────────────────────────────────────────────────────
listenBtn.addEventListener('click', () => {
  if (isSpeaking)  { stopSpeaking(); return; }
  if (isRecording) { stopRecording(); return; }
  startRecording();
});

settingsBtn.addEventListener('click', () => {
  window.voicetant.openSettings();
});

STATE.idle();