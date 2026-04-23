const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicetant', {
  // Audio
  saveAudio:               (payload)  => ipcRenderer.invoke('save-audio', payload),
  transcribeAudio:         (filePath) => ipcRenderer.invoke('transcribe-audio', filePath),

  // LLM
  askLlm:                  (payload)  => ipcRenderer.invoke('ask-llm', payload),

  // TTS
  speak:                   (text)     => ipcRenderer.invoke('tts-speak', text),
  stopSpeak:               ()         => ipcRenderer.invoke('tts-stop'),

  // Settings
  getSettings:             ()         => ipcRenderer.invoke('get-settings'),
  saveSettings:            (s)        => ipcRenderer.invoke('save-settings', s),
  openSettings:            ()         => ipcRenderer.invoke('open-settings'),
  closeSettings:           ()         => ipcRenderer.invoke('close-settings'),
  clearConversation:       ()         => ipcRenderer.invoke('clear-conversation'),
  testApiKey:              (payload)  => ipcRenderer.invoke('test-api-key', payload),

  onSettingsUpdated:       (cb)       => ipcRenderer.on('settings-updated', (_e, s) => cb(s)),
  onConversationCleared:   (cb)       => ipcRenderer.on('conversation-cleared', () => cb()),
  getAppEnvironment: () => ipcRenderer.invoke('get-app-environment'),
});