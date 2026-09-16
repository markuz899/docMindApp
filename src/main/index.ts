import path from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { createServices, type Services } from './services'

let mainWindow: BrowserWindow | null = null
let services: Services | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.docmind.app')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  try {
    services = createServices()
  } catch (error) {
    console.error('[docmind] fatal: could not open the database', error)
  }

  mainWindow = createWindow()
  if (services) registerIpc(services, () => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void services?.models.unload()
  services?.db.close()
})

// A background failure must never take the whole app down.
process.on('uncaughtException', (error) => console.error('[docmind] uncaught', error))
process.on('unhandledRejection', (reason) => console.error('[docmind] unhandled rejection', reason))
