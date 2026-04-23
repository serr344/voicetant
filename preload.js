const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicetant', {
  // Audio
  saveAudio:         (buffer)   => ipcRenderer.invoke('save-audio', buffer),
  transcribeAudio:   (filePath) => ipcRenderer.invoke('transcribe-audio', filePath),

  // LLM
  askLlm:            (payload)  => ipcRenderer.invoke('ask-llm', payload),

  // TTS
  speak:             (text)     => ipcRenderer.invoke('tts-speak', text),
  stopSpeak:         ()         => ipcRenderer.invoke('tts-stop'),

  // Settings
  getSettings:       ()         => ipcRenderer.invoke('get-settings'),
  saveSettings:      (s)        => ipcRenderer.invoke('save-settings', s),
  openSettings:      ()         => ipcRenderer.invoke('open-settings'),
  closeSettings:     ()         => ipcRenderer.invoke('close-settings'),
  onSettingsUpdated: (cb)       => ipcRenderer.on('settings-updated', (_e, s) => cb(s)),
});