const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['settings'];

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  widgetResize: (height) => ipcRenderer.send('widget-resize', height),
  widgetMenu: () => ipcRenderer.send('widget-menu'),
  widthStart: () => ipcRenderer.send('widget-width-start'),
  widthMove: (edge, dx) => ipcRenderer.send('widget-width-move', { edge, dx }),
  widthEnd: () => ipcRenderer.send('widget-width-end'),
  on: (channel, callback) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => callback(data));
  },
});
