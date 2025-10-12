const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('twitchAPI', {
  auth: () => ipcRenderer.invoke('auth'),
  logout: () => ipcRenderer.invoke('logout'),
  isLoggedIn: () => ipcRenderer.invoke('isLoggedIn'),
  createEngagement: (data) => ipcRenderer.invoke('createEngagement', data),
  getPollResults: (id) => ipcRenderer.invoke('getPollResults', id),
  getPredictionResults: (id) => ipcRenderer.invoke('getPredictionResults', id),

  // 🔽 new
  getSavedEngagements: () => ipcRenderer.invoke('getSavedEngagements'),
  saveEngagement: (data) => ipcRenderer.invoke('saveEngagement', data),
  deleteEngagement: (id) => ipcRenderer.invoke('deleteEngagement', id),
  resolvePrediction: (data) => ipcRenderer.invoke('resolvePrediction', data),
  updateEngagement: (data) => ipcRenderer.invoke('updateEngagement', data),
  reorderEngagements: (ids) => ipcRenderer.invoke('reorderEngagements', ids),
});
