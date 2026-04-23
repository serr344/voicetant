const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ── Settings store ───────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  apiService: 'groq',
  groqKey: '',
  openaiKey: '',
  llmModel: 'llama-3.3-70b-versatile',
  systemPrompt:
    'You are Voicetant, a fast and concise voice assistant. Always respond in English. Keep answers under 3 sentences. No markdown, no bullet points — plain spoken text only.',
  ttsRate: 1.0,
  launchAtStartup: false,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return {
        ...DEFAULT_SETTINGS,
        ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')),
      };
    }
  } catch (e) {
    console.error('[main] Failed to load settings:', e.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsToDisk(s) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('[main] Failed to save settings:', e.message);
  }
}

let settings = loadSettings();

// .env fallback for keys
require('dotenv').config({ path: path.join(__dirname, '.env') });

function getApiKey() {
  if (settings.apiService === 'openai') {
    return settings.openaiKey || process.env.OPENAI_API_KEY || '';
  }
  return settings.groqKey || process.env.GROQ_API_KEY || '';
}

function getBaseUrl() {
  return settings.apiService === 'openai'
    ? 'https://api.openai.com/v1'
    : 'https://api.groq.com/openai/v1';
}

// ── Error helpers ────────────────────────────────────────────────
function classifyApiError(status, errorText = '', context = 'generic') {
  const text = String(errorText || '').toLowerCase();

  if (status === 400) {
    if (
      text.includes('valid media file') ||
      text.includes('could not process file') ||
      text.includes('audio') ||
      text.includes('media')
    ) {
      return 'invalid_media';
    }

    if (text.includes('model')) {
      return 'model_not_found';
    }

    return 'bad_request';
  }

  if (status === 401) return 'invalid_api_key';
  if (status === 403) return 'forbidden';

  if (status === 404) {
    if (context === 'llm' && text.includes('model')) {
      return 'model_not_found';
    }
    return 'not_found';
  }

  if (status === 408) return 'timeout';
  if (status === 413) return 'file_too_large';
  if (status === 415) return 'invalid_media';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server_error';

  return 'unknown_error';
}

function classifyRuntimeError(err) {
  const msg = String(err?.message || err || '').toLowerCase();

  if (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('timed out') ||
    msg.includes('socket')
  ) {
    return 'network_error';
  }

  if (msg.includes('abort') || msg.includes('timeout')) {
    return 'timeout';
  }

  return 'unknown_error';
}

// ── Startup helper ───────────────────────────────────────────────
function applyLaunchAtStartup(enabled) {
  try {
    if (!app.isPackaged) {
      console.log('[main] Launch at startup skipped: app is not packaged.');
      return { ok: false, reason: 'not_packaged' };
    }

    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
    });

    const current = app.getLoginItemSettings();

    console.log('[main] Launch at startup updated:', {
      requested: enabled,
      actual: current.openAtLogin,
      execPath: process.execPath,
    });

    return { ok: true, enabled: current.openAtLogin };
  } catch (err) {
    console.error('[main] Failed to apply launch at startup:', err.message);
    return { ok: false, reason: 'failed' };
  }
}

// ── Audio helpers ────────────────────────────────────────────────
function getExtensionFromMimeType(mimeType = '') {
  const clean = String(mimeType).split(';')[0].trim().toLowerCase();

  switch (clean) {
    case 'audio/webm':
      return '.webm';
    case 'audio/ogg':
      return '.ogg';
    case 'audio/wav':
      return '.wav';
    case 'audio/mp4':
      return '.m4a';
    case 'audio/mpeg':
      return '.mp3';
    default:
      return '.webm';
  }
}

function normalizeMimeType(mimeType = '') {
  const clean = String(mimeType).split(';')[0].trim().toLowerCase();

  switch (clean) {
    case 'audio/webm':
    case 'audio/ogg':
    case 'audio/wav':
    case 'audio/mp4':
    case 'audio/mpeg':
      return clean;
    default:
      return 'audio/webm';
  }
}

function getMimeTypeFromFilePath(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.webm':
    default:
      return 'audio/webm';
  }
}

// ── Windows ──────────────────────────────────────────────────────
let mainWindow = null;
let settingsWindow = null;

function createMainWindow() {
  const W = 330;
  const H = 44;
  const { width, x, y } = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(x + (width - W) / 2),
    y: Math.round(y + 8),
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const { x: bx, y: by } = mainWindow.getBounds();

  settingsWindow = new BrowserWindow({
    width: 400,
    height: 580,
    x: bx,
    y: by + 52,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    frame: false,
    transparent: false,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ── IPC: Settings ────────────────────────────────────────────────
ipcMain.handle('get-settings', () => ({ ...settings }));

ipcMain.handle('save-settings', (_e, newSettings) => {
  settings = { ...DEFAULT_SETTINGS, ...newSettings };
  saveSettingsToDisk(settings);

  const startupResult = applyLaunchAtStartup(settings.launchAtStartup);

  if (mainWindow) {
    mainWindow.webContents.send('settings-updated', settings);
  }

  console.log(
    '[main] Settings saved. Service:',
    settings.apiService,
    '| Model:',
    settings.llmModel
  );

  return { ok: true, startupResult };
});

ipcMain.handle('open-settings', () => openSettingsWindow());

ipcMain.handle('close-settings', () => {
  if (settingsWindow) settingsWindow.close();
});

ipcMain.handle('clear-conversation', () => {
  if (mainWindow) {
    mainWindow.webContents.send('conversation-cleared');
  }

  console.log('[main] Conversation cleared.');
  return { ok: true };
});

ipcMain.handle('get-app-environment', () => {
  return {
    isPackaged: app.isPackaged,
  };
});

ipcMain.handle('test-api-key', async (_e, payload) => {
  const service = payload?.apiService || settings.apiService;
  const model = payload?.llmModel || settings.llmModel;

  const apiKey =
    service === 'openai'
      ? (payload?.openaiKey || '').trim()
      : (payload?.groqKey || '').trim();

  if (!apiKey) {
    return { ok: false, error: 'missing_api_key' };
  }

  const baseUrl =
    service === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://api.groq.com/openai/v1';

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Reply with exactly: OK' },
          { role: 'user', content: 'OK' },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const errorCode = classifyApiError(res.status, errText, 'llm');

      console.error('[main] API key test failed:', res.status, errText);
      return { ok: false, error: errorCode };
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';

    console.log('[main] API key test success:', service, model, '| reply:', reply);
    return { ok: true };
  } catch (err) {
    const errorCode = classifyRuntimeError(err);
    console.error('[main] API key test runtime error:', err.message);
    return { ok: false, error: errorCode };
  }
});

// ── IPC: Save audio ──────────────────────────────────────────────
ipcMain.handle('save-audio', async (_e, payload) => {
  try {
    const { buffer: arrayBuffer, mimeType } = payload || {};

    if (!arrayBuffer) {
      return { error: 'save_failed' };
    }

    const normalizedMimeType = normalizeMimeType(mimeType);
    const ext = getExtensionFromMimeType(normalizedMimeType);
    const buffer = Buffer.from(arrayBuffer);
    const savePath = path.join(os.tmpdir(), `voicetant-${Date.now()}${ext}`);

    fs.writeFileSync(savePath, buffer);

    console.log('[main] Audio saved:', savePath);
    console.log('[main] Audio MIME:', normalizedMimeType);

    return {
      filePath: savePath,
      mimeType: normalizedMimeType,
    };
  } catch (err) {
    console.error('[main] save-audio failed:', err.message);
    return { error: 'save_failed' };
  }
});

// ── IPC: Whisper STT ─────────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (_e, filePath) => {
  const apiKey = getApiKey();

  if (!apiKey) return { error: 'missing_api_key' };
  if (!fs.existsSync(filePath)) return { error: 'audio_file_not_found' };

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const fileMimeType = getMimeTypeFromFilePath(filePath);
    const boundary = `----VoicetantBoundary${Date.now()}`;

    const whisperModel =
      settings.apiService === 'openai' ? 'whisper-1' : 'whisper-large-v3-turbo';

    console.log(`[main] STT → ${settings.apiService} [${whisperModel}]`);
    console.log('[main] STT file:', fileName, '| MIME:', fileMimeType);

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="model"\r\n\r\n${whisperModel}\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="language"\r\n\r\nen\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="response_format"\r\n\r\njson\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
          `Content-Type: ${fileMimeType}\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const res = await fetch(`${getBaseUrl()}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      const errorCode = classifyApiError(res.status, errText, 'stt');

      console.error('[main] STT error:', res.status, errText);
      fs.unlink(filePath, () => {});
      return { error: errorCode };
    }

    const data = await res.json();
    const transcript = data.text?.trim() ?? '';

    console.log('[main] Transcript:', transcript);
    fs.unlink(filePath, () => {});
    return { transcript };
  } catch (err) {
    const errorCode = classifyRuntimeError(err);
    console.error('[main] STT failed:', err.message);

    try {
      fs.unlink(filePath, () => {});
    } catch (_) {}

    return { error: errorCode };
  }
});

// ── IPC: LLM ─────────────────────────────────────────────────────
ipcMain.handle('ask-llm', async (_e, { messages }) => {
  const apiKey = getApiKey();
  if (!apiKey) return { error: 'missing_api_key' };

  try {
    console.log(`[main] LLM → ${settings.apiService} [${settings.llmModel}]`);

    const res = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.llmModel || 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const errorCode = classifyApiError(res.status, errText, 'llm');

      console.error('[main] LLM error:', res.status, errText);
      return { error: errorCode };
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
    console.log('[main] LLM reply:', reply);
    return { reply };
  } catch (err) {
    const errorCode = classifyRuntimeError(err);
    console.error('[main] LLM failed:', err.message);
    return { error: errorCode };
  }
});

// ── IPC: TTS via PowerShell SAPI ────────────────────────────────
let ttsProcess = null;

function killTts() {
  if (ttsProcess) {
    try {
      process.kill(ttsProcess.pid, 'SIGKILL');
    } catch (_) {}
    ttsProcess.removeAllListeners();
    ttsProcess = null;
  }
}

ipcMain.handle('tts-speak', async (_e, text) => {
  killTts();

  const rate = settings.ttsRate ?? 1.0;
  const sapiRate = Math.round((rate - 1.0) * 10);
  const safe = String(text || '').replace(/'/g, "''");

  const script = [
    `Add-Type -AssemblyName System.Speech;`,
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`,
    `$s.SelectVoiceByHints([System.Globalization.CultureInfo]'en-US');`,
    `$s.Rate = ${sapiRate};`,
    `$s.Speak('${safe}');`,
  ].join(' ');

  return new Promise((resolve) => {
    ttsProcess = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        detached: false,
        stdio: 'ignore',
      }
    );

    console.log(`[main] TTS speaking [rate=${rate}x], PID:`, ttsProcess.pid);

    ttsProcess.on('close', (code) => {
      ttsProcess = null;
      console.log('[main] TTS done, code:', code);
      resolve({ done: true });
    });

    ttsProcess.on('error', (err) => {
      ttsProcess = null;
      console.error('[main] TTS error:', err.message);
      resolve({ error: err.message });
    });
  });
});

ipcMain.handle('tts-stop', async () => {
  killTts();
  console.log('[main] TTS stopped.');
  return { stopped: true };
});

// ── App lifecycle ────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  applyLaunchAtStartup(settings.launchAtStartup);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});