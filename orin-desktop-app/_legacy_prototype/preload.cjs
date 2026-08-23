const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('orin', {
  chooseFolder: () => ipcRenderer.invoke('orin:choose-folder'),
  readFile: filePath => ipcRenderer.invoke('orin:read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('orin:write-file', filePath, content),
})
