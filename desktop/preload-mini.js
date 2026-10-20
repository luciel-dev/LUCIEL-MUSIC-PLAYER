// Bridge for the floater (mini player) window: it can only send transport / window commands and receive state.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const on = (ch, cb) => { const h = (_e, v) => cb(v); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
contextBridge.exposeInMainWorld('lucielMiniHost', {
  platform: process.platform,
  send: (cmd, arg) => ipcRenderer.send('mini:cmd', String(cmd), typeof arg === 'number' && isFinite(arg) ? arg : arg === 'large' || arg === 'compact' ? arg : undefined),
  onState: (cb) => on('mini-state', cb),
  onWin: (cb) => on('mini-win', cb),
  ready: () => ipcRenderer.send('mini:ready'),
});
