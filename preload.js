const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicetant', {
  saveAudio:         (buffer)   => ipcRenderer.invoke('save-audio', buffer),
  transcribeAudio:   (filePath) => ipcRenderer.invoke('transcribe-audio', filePath),
  askLlm:            (payload)  => ipcRenderer.invoke('ask-llm', payload),
  speak:             (text)     => ipcRenderer.invoke('tts-speak', text),
  stopSpeak:         ()         => ipcRenderer.invoke('tts-stop'),
  onRecordingStatus: (cb)       => ipcRenderer.on('recording-status', (_e, s) => cb(s)),
});