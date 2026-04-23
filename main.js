const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');

// ── Settings store ───────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  apiService:      'groq',
  groqKey:         '',
  openaiKey:       '',
  llmModel:        'llama-3.3-70b-versatile',
  systemPrompt:    'You are Voicetant, a fast and concise voice assistant. Always respond in English. Keep answers under 3 sentences. No markdown, no bullet points — plain spoken text only.',
  ttsRate:         1.0,
  launchAtStartup: false,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    }
  } catch (e) { console.error('[main] Failed to load settings:', e.message); }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsToDisk(s) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8'); }
  catch (e) { console.error('[main] Failed to save settings:', e.message); }
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

// ── Windows ──────────────────────────────────────────────────────
let mainWindow     = null;
let settingsWindow = null;

function createMainWindow() {
  const W = 330, H = 44;
  const { width, x, y } = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    width: W, height: H,
    x: Math.round(x + (width - W) / 2),
    y: Math.round(y + 8),
    resizable: false, movable: true,
    minimizable: false, maximizable: false, closable: true,
    frame: false, transparent: true, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
    show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }

  const { x: bx, y: by } = mainWindow.getBounds();

  settingsWindow = new BrowserWindow({
    width: 400, height: 580,
    x: bx, y: by + 52,
    resizable: false, movable: true,
    minimizable: false, maximizable: false,
    frame: false, transparent: false, hasShadow: true,
    alwaysOnTop: true, skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── IPC: Settings ────────────────────────────────────────────────
ipcMain.handle('get-settings', () => ({ ...settings }));

ipcMain.handle('save-settings', (_e, newSettings) => {
  settings = { ...DEFAULT_SETTINGS, ...newSettings };
  saveSettingsToDisk(settings);
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup });
  }
  if (mainWindow) mainWindow.webContents.send('settings-updated', settings);
  console.log('[main] Settings saved. Service:', settings.apiService, '| Model:', settings.llmModel);
  return { ok: true };
});

ipcMain.handle('open-settings',  () => openSettingsWindow());
ipcMain.handle('close-settings', () => { if (settingsWindow) settingsWindow.close(); });

// ── IPC: Save audio ──────────────────────────────────────────────
ipcMain.handle('save-audio', async (_e, arrayBuffer) => {
  const buffer   = Buffer.from(arrayBuffer);
  const savePath = path.join(os.tmpdir(), `voicetant-${Date.now()}.webm`);
  fs.writeFileSync(savePath, buffer);
  console.log('[main] Audio saved:', savePath);
  return savePath;
});

// ── IPC: Whisper STT ─────────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (_e, filePath) => {
  const apiKey = getApiKey();
  if (!apiKey)                   return { error: 'Missing API key — check Settings' };
  if (!fs.existsSync(filePath))  return { error: 'Audio file not found' };

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName   = path.basename(filePath);
    const boundary   = `----VoicetantBoundary${Date.now()}`;

    // Whisper model: groq uses whisper-large-v3-turbo, openai uses whisper-1
    const whisperModel = settings.apiService === 'openai' ? 'whisper-1' : 'whisper-large-v3-turbo';

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${whisperModel}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/webm\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    console.log(`[main] STT → ${settings.apiService} [${whisperModel}]`);

    const res = await fetch(`${getBaseUrl()}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[main] STT error:', res.status, err);
      return { error: `STT error ${res.status}` };
    }

    const data       = await res.json();
    const transcript = data.text?.trim() ?? '';
    console.log('[main] Transcript:', transcript);
    fs.unlink(filePath, () => {});
    return { transcript };

  } catch (err) {
    console.error('[main] STT failed:', err.message);
    return { error: err.message };
  }
});

// ── IPC: LLM ────────────────────────────────────────────────────
ipcMain.handle('ask-llm', async (_e, { messages }) => {
  const apiKey = getApiKey();
  if (!apiKey) return { error: 'Missing API key — check Settings' };

  try {
    console.log(`[main] LLM → ${settings.apiService} [${settings.llmModel}]`);

    const res = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       settings.llmModel || 'llama-3.3-70b-versatile',
        messages,
        max_tokens:  512,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[main] LLM error:', res.status, err);
      return { error: `LLM error ${res.status}` };
    }

    const data  = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
    console.log('[main] LLM reply:', reply);
    return { reply };

  } catch (err) {
    console.error('[main] LLM failed:', err.message);
    return { error: err.message };
  }
});

// ── IPC: TTS via PowerShell SAPI ────────────────────────────────
let ttsProcess = null;

function killTts() {
  if (ttsProcess) {
    try { process.kill(ttsProcess.pid, 'SIGKILL'); } catch (_) {}
    ttsProcess.removeAllListeners();
    ttsProcess = null;
  }
}

ipcMain.handle('tts-speak', async (_e, text) => {
  killTts();

  const rate   = settings.ttsRate ?? 1.0;
  const sapiRate = Math.round((rate - 1.0) * 10); // -5 to +10
  const safe   = text.replace(/'/g, "''");

  const script = [
    `Add-Type -AssemblyName System.Speech;`,
    `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`,
    `$s.SelectVoiceByHints([System.Globalization.CultureInfo]'en-US');`,
    `$s.Rate = ${sapiRate};`,
    `$s.Speak('${safe}');`,
  ].join(' ');

  return new Promise((resolve) => {
    ttsProcess = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      detached: false, stdio: 'ignore',
    });

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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});