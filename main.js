const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

require('dotenv').config({ path: path.join(__dirname, '.env') });

let mainWindow;

function createWindow() {
  const windowWidth  = 330;
  const windowHeight = 44;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, x, y } = primaryDisplay.workArea;

  const posX = Math.round(x + (width - windowWidth) / 2);
  const posY = Math.round(y + 8);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: posX,
    y: posY,
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
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC: save audio to temp file ────────────────────────────────
ipcMain.handle('save-audio', async (_event, arrayBuffer) => {
  const buffer    = Buffer.from(arrayBuffer);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName  = `voicetant-${timestamp}.webm`;
  const savePath  = path.join(os.tmpdir(), fileName);

  fs.writeFileSync(savePath, buffer);
  console.log('[main] Audio saved:', savePath);
  return savePath;
});

// ── IPC: send to Groq Whisper API ───────────────────────────────
ipcMain.handle('transcribe-audio', async (_event, filePath) => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error('[main] GROQ_API_KEY not found. Check your .env file.');
    return { error: 'Missing API key' };
  }

  if (!fs.existsSync(filePath)) {
    console.error('[main] Audio file not found:', filePath);
    return { error: 'File not found' };
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName   = path.basename(filePath);
    const boundary   = `----VoicetantBoundary${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `whisper-large-v3-turbo\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `en\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `json\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: audio/webm\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    console.log('[main] Sending to Groq Whisper API...');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[main] Groq Whisper error:', response.status, errText);
      return { error: `API error: ${response.status}` };
    }

    const data       = await response.json();
    const transcript = data.text?.trim() ?? '';

    console.log('[main] Transcript:', transcript);
    fs.unlink(filePath, () => {});

    return { transcript };

  } catch (err) {
    console.error('[main] Whisper request failed:', err.message);
    return { error: err.message };
  }
});

// ── IPC: send transcript to Groq LLM ────────────────────────────
ipcMain.handle('ask-llm', async (_event, { messages }) => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error('[main] GROQ_API_KEY not found.');
    return { error: 'Missing API key' };
  }

  try {
    console.log('[main] Sending to Groq LLM...');

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[main] Groq LLM error:', response.status, errText);
      return { error: `LLM error: ${response.status}` };
    }

    const data  = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';

    console.log('[main] LLM reply:', reply);
    return { reply };

  } catch (err) {
    console.error('[main] LLM request failed:', err.message);
    return { error: err.message };
  }
});

// ── IPC: TTS via PowerShell SAPI ────────────────────────────────
const { exec, execSync } = require('child_process');
let ttsProcess = null;

ipcMain.handle('tts-speak', async (_event, text) => {
  if (ttsProcess) {
    try { execSync('taskkill /F /IM powershell.exe /T'); } catch(_) {}
    ttsProcess = null;
  }

  const safe = text.replace(/'/g, "''");
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoiceByHints('en-US'); $s.Speak('${safe}')`;
  const cmd = `powershell -NoProfile -Command "${script}"`;

  return new Promise((resolve) => {
    ttsProcess = exec(cmd, (err) => {
      ttsProcess = null;
      if (err && err.killed) { resolve({ stopped: true }); return; }
      if (err) console.error('[main] TTS error:', err.message);
      resolve({ done: true });
    });
    console.log('[main] TTS speaking...');
  });
});

ipcMain.handle('tts-stop', async () => {
  if (ttsProcess) {
    try { execSync('taskkill /F /IM powershell.exe /T'); } catch(_) {}
    ttsProcess = null;
    console.log('[main] TTS stopped.');
  }
  return { stopped: true };
});

// ── App lifecycle ────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});