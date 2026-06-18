const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remindy', {
  onRemind: (cb) => ipcRenderer.on('remind', (_e, payload) => cb(payload)),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  calendar: (kind) => ipcRenderer.send('calendar', kind),
  pasteCalendar: () => ipcRenderer.send('paste-calendar'),
  quote: () => ipcRenderer.send('quote'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  quit: () => ipcRenderer.send('quit'),
});
