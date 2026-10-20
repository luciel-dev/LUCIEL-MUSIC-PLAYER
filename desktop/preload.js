// Bridge exposed to the page as window.lucielNative (fsx.js / app.js / desktop.js use it when present).
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const on = (ch, cb) => { const h = (_e, v) => cb(v); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
contextBridge.exposeInMainWorld('lucielNative', {
  isDesktop: true,
  platform: process.platform,
  // files
  pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  readPaths: (paths) => ipcRenderer.invoke('fs:readPaths', paths),
  writeFile: (p, data) => ipcRenderer.invoke('fs:writeFile', p, data),
  rename: (p, newName) => ipcRenderer.invoke('fs:rename', p, newName),
  pickFiles: () => ipcRenderer.invoke('dlg:pickFiles'),
  pickFolder: () => ipcRenderer.invoke('dlg:pickFolder'),
  // window
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
  close: () => ipcRenderer.send('win:close'),
  winState: () => ipcRenderer.invoke('win:state'),
  onWinState: (cb) => on('win-state', cb),
  // app
  onOpenPaths: (cb) => { const off = on('open-paths', cb); ipcRenderer.send('app:ready'); return off; },
  onCommand: (cb) => on('command', cb),
  setState: (s) => ipcRenderer.send('app:state', s),
  setSkin: (s) => ipcRenderer.send('app:skin', s),
  // mini player (floater window): this page stays the audio host and pushes state; the floater sends commands back
  mini: {
    toggle: (o) => ipcRenderer.send('mini:toggle', o || {}),
    open: (o) => ipcRenderer.send('mini:open', o || {}),
    close: () => ipcRenderer.send('mini:close'),
    showMain: () => ipcRenderer.send('mini:showMain'),
    state: (s) => ipcRenderer.send('mini:state', s),
    onOpen: (cb) => on('mini-open', cb),
    onCmd: (cb) => on('mini-cmd', cb),
  },
  // visual packs stored in userData/packs (validated again in the main process)
  packs: {
    list: () => ipcRenderer.invoke('packs:list'),
    install: (req) => ipcRenderer.invoke('packs:install', req),
    remove: (id) => ipcRenderer.invoke('packs:remove', id),
    setEnabled: (id, on) => ipcRenderer.invoke('packs:setEnabled', id, !!on),
  },
});
