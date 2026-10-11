import { contextBridge, ipcRenderer } from 'electron';
// A narrow bridge, no arbitrary IPC, command execution, filesystem or Electron object in the page.
contextBridge.exposeInMainWorld('okbDesktop', Object.freeze({
  version: process.versions.electron,
  platform: process.platform,
  chooseFolder: () => ipcRenderer.invoke('okb:choose-folder'),
  updates: Object.freeze({
    status: () => ipcRenderer.invoke('okb:update', 'status'),
    check: () => ipcRenderer.invoke('okb:update', 'check'),
    download: () => ipcRenderer.invoke('okb:update', 'download'),
    install: () => ipcRenderer.invoke('okb:update', 'install'),
  }),
}));
