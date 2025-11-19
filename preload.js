// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});

contextBridge.exposeInMainWorld('windowCtl', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close:    () => ipcRenderer.invoke('window:close')
});

contextBridge.exposeInMainWorld('companion', {
  start: () => ipcRenderer.invoke('companion:start'),
  stop:  () => ipcRenderer.invoke('companion:stop'),
  onState:      (cb) => ipcRenderer.on('companion:state',      (_, s) => cb(s)),
  onTranscript: (cb) => ipcRenderer.on('companion:transcript', (_, t) => cb(t)),
  onSuggestion: (cb) => ipcRenderer.on('companion:suggestion', (_, s) => cb(s))
});
