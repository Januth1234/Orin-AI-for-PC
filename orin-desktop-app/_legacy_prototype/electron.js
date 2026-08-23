import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const fileTree = async (folder, depth = 0) => {
  if (depth > 3) return []
  const entries = await fs.readdir(folder, { withFileTypes: true })
  const safeEntries = entries.filter(entry => !['node_modules', '.git', 'dist', 'out'].includes(entry.name)).slice(0, 250)
  return Promise.all(safeEntries.map(async entry => {
    const fullPath = path.join(folder, entry.name)
    if (entry.isDirectory()) return { name: entry.name, path: fullPath, type: 'folder', children: await fileTree(fullPath, depth + 1) }
    return { name: entry.name, path: fullPath, type: 'file' }
  }))
}

ipcMain.handle('orin:choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  const rootPath = result.filePaths[0]
  return { rootPath, name: path.basename(rootPath), files: await fileTree(rootPath) }
})

ipcMain.handle('orin:read-file', async (_event, filePath) => fs.readFile(filePath, 'utf8'))
ipcMain.handle('orin:write-file', async (_event, filePath, content) => { await fs.writeFile(filePath, content, 'utf8'); return true })

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#11110f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  // Add additional setup steps here

}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
