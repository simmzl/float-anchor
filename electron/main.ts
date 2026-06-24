import { app, BrowserWindow, ipcMain, shell, protocol, net, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { exec } from 'node:child_process'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import {
  normalizeSyncData, summarizeSyncData, hasMeaningfulSyncData, getComparableSyncSnapshot,
  formatSyncSummary, isHighRiskRemoteOverwrite, buildSyncDecision,
} from './sync/summary'
import type { SyncSummary, SyncResolution } from './sync/summary'
import {
  IMAGE_EXTENSION_CANDIDATES, getImageBasename, extractStoredImageName,
  isRemoteImageNameMatch, getReferencedImageNames,
} from './sync/image-names'

let dataDir = ''
let dataFile = ''
let settingsFile = ''

function getDataPaths() {
  if (!dataDir) {
    dataDir = path.join(app.getPath('userData'), 'data')
    dataFile = path.join(dataDir, 'float-anchor.json')
    settingsFile = path.join(dataDir, 'float-anchor-settings.json')
  }
  return { dataDir, dataFile, settingsFile }
}

let mainWindow: BrowserWindow | null = null

const GITHUB_OWNER = 'swordrada'
const GITHUB_REPO = 'float-anchor'
const CURRENT_VERSION = app.getVersion()

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

async function httpsGetJSON(url: string): Promise<any> {
  const resp = await net.fetch(url, {
    headers: {
      'User-Agent': 'FloatAnchor-Updater',
      Accept: 'application/vnd.github+json',
    },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

function getDownloadMeta(destPath: string) {
  return destPath + '.meta'
}

function isUpdateCancelledError(err: unknown) {
  return err instanceof Error && err.name === 'AbortError'
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const partPath = destPath + '.part'
  let existingBytes = 0
  if (fs.existsSync(partPath)) {
    existingBytes = fs.statSync(partPath).size
  }

  const headers: Record<string, string> = {
    'User-Agent': 'FloatAnchor-Updater',
    Accept: 'application/octet-stream',
  }
  if (existingBytes > 0) {
    headers['Range'] = `bytes=${existingBytes}-`
  }

  const resp = await net.fetch(url, { headers, signal })

  if (!resp.ok && resp.status !== 206) {
    throw new Error(`HTTP ${resp.status}`)
  }

  const isPartial = resp.status === 206
  if (resp.status === 200 && existingBytes > 0) {
    existingBytes = 0
  }

  let totalBytes: number
  if (isPartial) {
    const cr = resp.headers.get('content-range')
    totalBytes = cr ? parseInt(cr.split('/')[1], 10) : 0
  } else {
    totalBytes = parseInt(resp.headers.get('content-length') || '0', 10)
  }

  if (totalBytes > 0) {
    fs.writeFileSync(getDownloadMeta(destPath), JSON.stringify({ totalBytes, url }))
  }

  let downloaded = existingBytes
  const ws = fs.createWriteStream(partPath, { flags: isPartial ? 'a' : 'w' })

  const reader = resp.body?.getReader()
  if (!reader) throw new Error('No response body')

  let streamError: unknown = null
  try {
    while (true) {
      if (signal?.aborted) {
        const err = new Error('update-cancelled')
        err.name = 'AbortError'
        throw err
      }
      const { done, value } = await reader.read()
      if (done) break
      ws.write(Buffer.from(value))
      downloaded += value.byteLength
      if (totalBytes > 0 && onProgress) onProgress(Math.round((downloaded / totalBytes) * 100))
    }
  } catch (err) {
    streamError = err
  } finally {
    reader.releaseLock()
  }

  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve())
    ws.on('error', reject)
  })

  if (streamError) throw streamError

  fs.renameSync(partPath, destPath)
  try { fs.unlinkSync(getDownloadMeta(destPath)) } catch {}
}

function getResumePercent(destPath: string): number {
  const partPath = destPath + '.part'
  const metaPath = getDownloadMeta(destPath)
  if (!fs.existsSync(partPath) || !fs.existsSync(metaPath)) return 0
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const downloaded = fs.statSync(partPath).size
    if (meta.totalBytes > 0) return Math.round((downloaded / meta.totalBytes) * 100)
  } catch {}
  return 0
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface ReleaseInfo {
  tag_name: string
  assets: ReleaseAsset[]
}

let updateCheckTimer: ReturnType<typeof setInterval> | null = null

async function checkForUpdates(): Promise<{ hasUpdate: boolean; version?: string; currentVersion: string }> {
  try {
    const release: ReleaseInfo = await httpsGetJSON(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    )
    const latestVersion = release.tag_name.replace(/^v/, '')
    if (compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
      return { hasUpdate: false, currentVersion: CURRENT_VERSION }
    }

    const platform = process.platform
    const arch = process.arch
    let assetName = ''
    if (platform === 'darwin') {
      assetName = arch === 'x64'
        ? `FloatAnchor-${latestVersion}-mac-x64.dmg`
        : `FloatAnchor-${latestVersion}-mac-arm64.dmg`
    } else {
      assetName = `FloatAnchor-${latestVersion}-win-setup.exe`
    }

    const asset = release.assets.find((a) => a.name === assetName)
    if (!asset) return { hasUpdate: false, currentVersion: CURRENT_VERSION }

    const tmpDir = path.join(app.getPath('temp'), 'float-anchor-update')
    const destPath = path.join(tmpDir, asset.name)
    const alreadyDownloaded = fs.existsSync(destPath)
    const resumePct = alreadyDownloaded ? 100 : getResumePercent(destPath)

    mainWindow?.webContents.send('update-available', {
      version: latestVersion,
      currentVersion: CURRENT_VERSION,
      assetName: asset.name,
      downloadUrl: asset.browser_download_url,
      resumePercent: resumePct,
    })

    return { hasUpdate: true, version: latestVersion, currentVersion: CURRENT_VERSION }
  } catch (err) {
    console.error('Update check failed:', err)
    return { hasUpdate: false, currentVersion: CURRENT_VERSION }
  }
}

function startUpdateChecker() {
  setTimeout(() => checkForUpdates(), 3000)
  updateCheckTimer = setInterval(() => checkForUpdates(), 60_000)
}

ipcMain.handle('check-update', async () => {
  return checkForUpdates()
})

ipcMain.handle('get-resume-progress', async (_event, assetName: string) => {
  const tmpDir = path.join(app.getPath('temp'), 'float-anchor-update')
  const destPath = path.join(tmpDir, assetName)
  if (fs.existsSync(destPath)) return 100
  return getResumePercent(destPath)
})

let activeDownloadAbort: (() => void) | null = null
let activeDownloadPath: string | null = null

ipcMain.handle('trigger-update', async (_event, downloadUrl: string, assetName: string) => {
  if (activeDownloadAbort) {
    return { success: false, error: '已有更新任务正在进行' }
  }

  const controller = new AbortController()
  try {
    const tmpDir = path.join(app.getPath('temp'), 'float-anchor-update')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const destPath = path.join(tmpDir, assetName)
    activeDownloadAbort = () => controller.abort()
    activeDownloadPath = destPath

    const resumePct = getResumePercent(destPath)
    mainWindow?.webContents.send('update-progress', { stage: 'downloading', percent: resumePct })

    await downloadFile(downloadUrl, destPath, (pct) => {
      mainWindow?.webContents.send('update-progress', { stage: 'downloading', percent: pct })
    }, controller.signal)

    mainWindow?.webContents.send('update-progress', { stage: 'installing', percent: 100 })

    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => {
        exec(`hdiutil attach "${destPath}" -nobrowse`, (err, stdout) => {
          if (err) return reject(err)
          const volumeMatch = stdout.match(/\/Volumes\/.+/)
          if (!volumeMatch) return reject(new Error('Failed to mount DMG'))
          const volumePath = volumeMatch[0].trim()
          const appName = 'FloatAnchor.app'
          const srcApp = path.join(volumePath, appName)
          const destApp = `/Applications/${appName}`

          exec(`rm -rf "${destApp}" && cp -R "${srcApp}" "${destApp}" && hdiutil detach "${volumePath}"`, (err2) => {
            if (err2) return reject(err2)
            resolve()
          })
        })
      })
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
      app.relaunch({ execPath: '/Applications/FloatAnchor.app/Contents/MacOS/FloatAnchor' })
      app.exit(0)
    } else {
      exec(`start "" "${destPath}"`)
      setTimeout(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
        app.exit(0)
      }, 2000)
    }

    return { success: true }
  } catch (err) {
    if (isUpdateCancelledError(err)) {
      const resumePct = activeDownloadPath ? getResumePercent(activeDownloadPath) : 0
      mainWindow?.webContents.send('update-progress', { stage: 'cancelled', percent: resumePct })
      return { success: false, error: 'cancelled' }
    }
    console.error('Update failed:', err)
    mainWindow?.webContents.send('update-progress', { stage: 'error', percent: 0 })
    return { success: false, error: String(err) }
  } finally {
    activeDownloadAbort = null
    activeDownloadPath = null
  }
})

ipcMain.handle('cancel-update', async () => {
  if (!activeDownloadAbort) {
    return { success: false, error: '当前没有正在下载的更新任务' }
  }
  activeDownloadAbort()
  return { success: true }
})

function getThemeFromSettings(): 'light' | 'dark' {
  try {
    const { settingsFile: file } = getDataPaths()
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (s.theme === 'dark') return 'dark'
    }
  } catch {}
  return 'light'
}

function createWindow() {
  const theme = getThemeFromSettings()
  const isDark = theme === 'dark'
  const bgColor = isDark ? '#1a1a1e' : '#f0f0f0'
  const windowIcon = process.platform === 'win32'
    ? path.join(__dirname, '../build/icon.png')
    : undefined

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: isDark ? '#212125' : '#f0f0f0',
      symbolColor: isDark ? '#ccc' : '#555',
      height: 38,
    } : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: bgColor,
    icon: windowIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function ensureDataDir() {
  const { dataDir: dir } = getDataPaths()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

ipcMain.handle('read-data', async () => {
  try {
    const { dataFile: file } = getDataPaths()
    ensureDataDir()
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8')
      return JSON.parse(raw)
    }
  } catch (err) {
    console.error('Failed to read data:', err)
  }
  return null
})

ipcMain.handle('write-data', async (_event, data: unknown) => {
  try {
    const { dataFile: file } = getDataPaths()
    ensureDataDir()
    const dataToWrite = (data && typeof data === 'object' && !Array.isArray(data))
      ? { ...(data as Record<string, unknown>) }
      : data

    if (
      dataToWrite &&
      typeof dataToWrite === 'object' &&
      !Array.isArray(dataToWrite) &&
      typeof (dataToWrite as Record<string, unknown>)._syncTimestamp !== 'number' &&
      fs.existsSync(file)
    ) {
      try {
        const writableData = dataToWrite as Record<string, unknown>
        const existing = JSON.parse(fs.readFileSync(file, 'utf-8'))
        if (typeof existing?._syncTimestamp === 'number') {
          writableData._syncTimestamp = existing._syncTimestamp
        }
      } catch {}
    }

    fs.writeFileSync(file, JSON.stringify(dataToWrite, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('Failed to write data:', err)
    return false
  }
})

ipcMain.handle('read-settings', async () => {
  try {
    const { settingsFile: file } = getDataPaths()
    ensureDataDir()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to read settings:', err)
  }
  return null
})

ipcMain.handle('write-settings', async (_event, data: unknown) => {
  try {
    const { settingsFile: file } = getDataPaths()
    ensureDataDir()
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('Failed to write settings:', err)
    return false
  }
})

/* ===== WebDAV Sync ===== */

let syncTimer: ReturnType<typeof setTimeout> | undefined
const WEBDAV_REMOTE_DIR = 'FloatAnchor'
const WEBDAV_REMOTE_FILE = 'FloatAnchor/float-anchor.json'
const WEBDAV_REMOTE_IMAGES_DIR = 'FloatAnchor/images'
const MAX_BACKUPS = 5
const LOCAL_SYNC_DIRTY_TOLERANCE_MS = 1500

let webdavSyncQueue: Promise<void> = Promise.resolve()

function enqueueWebDAVSync<T>(task: () => Promise<T>): Promise<T> {
  const next = webdavSyncQueue.then(task, task)
  webdavSyncQueue = next.then(() => undefined, () => undefined)
  return next
}

function createBackup() {
  try {
    const { dataDir: dir, dataFile: file } = getDataPaths()
    if (!fs.existsSync(file)) return
    const backupDir = path.join(dir, 'backups')
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(file, path.join(backupDir, `backup-${ts}.json`))
    const files = fs.readdirSync(backupDir).sort()
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(backupDir, files.shift()!))
    }
  } catch (err) {
    console.error('Backup failed:', err)
  }
}

async function getWebDAVClient(config: { server: string; username: string; password: string }) {
  const { createClient } = await import('webdav')
  return createClient(config.server, {
    username: config.username,
    password: config.password,
  })
}

function getImagesDir() {
  const { dataDir: dir } = getDataPaths()
  return path.join(dir, 'images')
}

function isRealImageFile(filePath: string) {
  try {
    const header = fs.readFileSync(filePath).subarray(0, 12)
    return (
      header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      header.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ||
      header.subarray(0, 4).toString('ascii') === 'GIF8' ||
      (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') ||
      header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
    )
  } catch {
    return false
  }
}

function resolveStoredImagePath(fileName: string) {
  const imagesDir = getImagesDir()
  const normalizedName = path.basename(fileName)
  const exactPath = path.join(imagesDir, normalizedName)
  if (fs.existsSync(exactPath) && isRealImageFile(exactPath)) return exactPath

  const baseName = path.parse(normalizedName).name || normalizedName
  for (const ext of IMAGE_EXTENSION_CANDIDATES) {
    const candidate = path.join(imagesDir, `${baseName}${ext}`)
    if (fs.existsSync(candidate) && isRealImageFile(candidate)) return candidate
  }

  return null
}

async function ensureRemoteDirectory(client: any, remoteDir: string) {
  try {
    const exists = await client.exists(remoteDir)
    if (!exists) {
      await client.createDirectory(remoteDir)
    }
  } catch (err) {
    console.log(`ensureRemoteDirectory note for ${remoteDir}:`, err)
  }
}

async function ensureRemoteDir(client: any) {
  await ensureRemoteDirectory(client, WEBDAV_REMOTE_DIR)
}

function listLocalImageFiles(imagesDir: string): string[] {
  if (!fs.existsSync(imagesDir)) return []
  return fs.readdirSync(imagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
}

function toBinaryBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array) return Buffer.from(content)
  if (content instanceof ArrayBuffer) return Buffer.from(content)
  if (typeof content === 'string') return Buffer.from(content, 'binary')
  return Buffer.from([])
}

async function uploadLocalImages(client: any) {
  const imagesDir = getImagesDir()
  const imageFiles = listLocalImageFiles(imagesDir)
  if (imageFiles.length === 0) return 0

  await ensureRemoteDirectory(client, WEBDAV_REMOTE_IMAGES_DIR)
  for (const fileName of imageFiles) {
    const filePath = path.join(imagesDir, fileName)
    await client.putFileContents(`${WEBDAV_REMOTE_IMAGES_DIR}/${fileName}`, fs.readFileSync(filePath), { overwrite: true })
  }
  return imageFiles.length
}

async function getRemoteImageFiles(client: any) {
  const exists = await client.exists(WEBDAV_REMOTE_IMAGES_DIR)
  if (!exists) return []

  const entries = await client.getDirectoryContents(WEBDAV_REMOTE_IMAGES_DIR)
  return (Array.isArray(entries) ? entries : [entries]).filter((entry: any) => entry?.type === 'file')
}

async function downloadRemoteImages(client: any) {
  const files = await getRemoteImageFiles(client)
  if (files.length === 0) return 0

  const imagesDir = getImagesDir()
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })

  for (const entry of files) {
    const remotePath = typeof entry.filename === 'string'
      ? entry.filename
      : `${WEBDAV_REMOTE_IMAGES_DIR}/${entry.basename}`
    const fileName = entry.basename || path.posix.basename(remotePath)
    if (!fileName) continue
    const binary = await client.getFileContents(remotePath, { format: 'binary' })
    fs.writeFileSync(path.join(imagesDir, fileName), toBinaryBuffer(binary))
  }

  return files.length
}

function getMissingLocalImageNames(data: any) {
  return Array.from(getReferencedImageNames(data)).filter((fileName) => !resolveStoredImagePath(fileName))
}

async function downloadMissingRemoteImagesForData(client: any, data: any) {
  const missingNames = getMissingLocalImageNames(data)
  if (missingNames.length === 0) return 0

  const remoteFiles = await getRemoteImageFiles(client)
  if (remoteFiles.length === 0) return 0

  const imagesDir = getImagesDir()
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })

  let downloaded = 0
  for (const missingName of missingNames) {
    const remoteEntry = remoteFiles.find((entry: any) => {
      const remoteName = entry.basename || path.posix.basename(entry.filename || '')
      return remoteName && isRemoteImageNameMatch(getImageBasename(missingName), remoteName)
    })
    if (!remoteEntry) continue

    const remotePath = typeof remoteEntry.filename === 'string'
      ? remoteEntry.filename
      : `${WEBDAV_REMOTE_IMAGES_DIR}/${remoteEntry.basename}`
    const remoteName = remoteEntry.basename || path.posix.basename(remotePath)
    const targetName = getImageBasename(missingName) || remoteName
    const targetExt = path.extname(targetName)
    const remoteExt = path.extname(remoteName)
    const localFileName = targetExt ? targetName : `${targetName}${remoteExt}`
    const binary = await client.getFileContents(remotePath, { format: 'binary' })
    fs.writeFileSync(path.join(imagesDir, localFileName), toBinaryBuffer(binary))
    downloaded += 1
  }

  return downloaded
}

function getCardCount(data: any) {
  return (data?.canvases || []).reduce((sum: number, canvas: any) => sum + (canvas.cards?.length || 0), 0)
}

function getLocalFileModifiedAt(file: string) {
  try {
    if (!fs.existsSync(file)) return 0
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function markLocalSnapshotSynced(file: string, syncTimestamp: number) {
  if (!syncTimestamp || !fs.existsSync(file)) return
  try {
    const syncedTime = new Date(syncTimestamp)
    fs.utimesSync(file, syncedTime, syncedTime)
  } catch (err) {
    console.log('markLocalSnapshotSynced note:', err)
  }
}

function hasMissingLocalImages(data: any) {
  return getMissingLocalImageNames(data).length > 0
}

async function uploadLocalSnapshot(client: any, file: string) {
  const raw = fs.readFileSync(file, 'utf-8')
  const data = normalizeSyncData(JSON.parse(raw), Date.now())
  data._syncTimestamp = Date.now()

  await ensureRemoteDir(client)
  await uploadLocalImages(client)
  await client.putFileContents(WEBDAV_REMOTE_FILE, JSON.stringify(data, null, 2), { overwrite: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  markLocalSnapshotSynced(file, data._syncTimestamp)

  return data
}

async function loadRemoteSnapshot(client: any) {
  if (!await client.exists(WEBDAV_REMOTE_FILE)) return null
  const remoteRaw = await client.getFileContents(WEBDAV_REMOTE_FILE, { format: 'text' })
  return normalizeSyncData(JSON.parse(remoteRaw as string))
}

async function applyRemoteSnapshot(client: any, file: string, remoteData: any) {
  const normalized = normalizeSyncData(remoteData, Date.now())
  createBackup()
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf-8')
  markLocalSnapshotSynced(file, normalized._syncTimestamp)
  await downloadRemoteImages(client)
  return normalized
}

async function reconcileWebDAVState(config: { server: string; username: string; password: string }) {
  const { dataFile: file } = getDataPaths()
  ensureDataDir()

  let localData: any = null
  let localTs = 0
  const hasLocalFile = fs.existsSync(file)
  if (hasLocalFile) {
    try {
      localData = normalizeSyncData(JSON.parse(fs.readFileSync(file, 'utf-8')))
      localTs = localData._syncTimestamp || 0
    } catch {}
  }

  const localSummary = summarizeSyncData(localData)
  const localFingerprint = localData ? getComparableSyncSnapshot(localData) : ''
  const localModifiedAt = getLocalFileModifiedAt(file)
  const localDirty = !!localData && localModifiedAt > localTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS

  const client = await getWebDAVClient(config)
  const remoteData = await loadRemoteSnapshot(client)
  if (!remoteData) {
    if (hasLocalFile && localData && hasMeaningfulSyncData(localSummary)) {
      await uploadLocalSnapshot(client, file)
      return { success: true, action: 'uploaded' as const }
    }
    return { success: true, action: 'up-to-date' as const }
  }

  const remoteTs = remoteData._syncTimestamp || 0
  const remoteSummary = summarizeSyncData(remoteData)
  const remoteFingerprint = getComparableSyncSnapshot(remoteData)
  const localMissingImagesDownloaded = localData
    ? await downloadMissingRemoteImagesForData(client, localData)
    : 0

  if (!localData) {
    if (hasMeaningfulSyncData(remoteSummary)) {
      const appliedRemote = await applyRemoteSnapshot(client, file, remoteData)
      return { success: true, action: 'downloaded' as const, data: appliedRemote }
    }
    return { success: true, action: 'up-to-date' as const }
  }

  if (localFingerprint === remoteFingerprint) {
    if (localMissingImagesDownloaded > 0) {
      return { success: true, action: 'downloaded' as const, data: localData }
    }
    return { success: true, action: 'up-to-date' as const }
  }

  if (localDirty) {
    if (remoteTs > localTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS) {
      return {
        success: true,
        action: 'needs-confirmation' as const,
        decision: buildSyncDecision(localData, remoteData, 'diverged'),
      }
    }
    await uploadLocalSnapshot(client, file)
    return { success: true, action: 'uploaded' as const }
  }

  if (localTs > remoteTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS && hasLocalFile) {
    await uploadLocalSnapshot(client, file)
    return { success: true, action: 'uploaded' as const }
  }

  if (remoteTs > localTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS) {
    if (!hasMeaningfulSyncData(localSummary) && hasMeaningfulSyncData(remoteSummary)) {
      const appliedRemote = await applyRemoteSnapshot(client, file, remoteData)
      return { success: true, action: 'downloaded' as const, data: appliedRemote }
    }
    return {
      success: true,
      action: 'needs-confirmation' as const,
      decision: buildSyncDecision(
        localData,
        remoteData,
        isHighRiskRemoteOverwrite(localSummary, remoteSummary) ? 'destructive-remote' : 'remote-newer',
      ),
    }
  }

  if (!hasMeaningfulSyncData(localSummary) && hasMeaningfulSyncData(remoteSummary)) {
    const appliedRemote = await applyRemoteSnapshot(client, file, remoteData)
    return { success: true, action: 'downloaded' as const, data: appliedRemote }
  }

  if (hasMeaningfulSyncData(localSummary) && !hasMeaningfulSyncData(remoteSummary) && hasLocalFile) {
    await uploadLocalSnapshot(client, file)
    return { success: true, action: 'uploaded' as const }
  }

  return {
    success: true,
    action: 'needs-confirmation' as const,
    decision: buildSyncDecision(
      localData,
      remoteData,
      isHighRiskRemoteOverwrite(localSummary, remoteSummary) ? 'destructive-remote' : 'diverged',
    ),
  }
}

async function resolveWebDAVConflict(
  config: { server: string; username: string; password: string },
  resolution: SyncResolution,
) {
  const { dataFile: file } = getDataPaths()
  ensureDataDir()
  const client = await getWebDAVClient(config)

  if (resolution === 'keep-local') {
    if (!fs.existsSync(file)) {
      return { success: false, error: '没有找到本地数据文件' }
    }
    const uploaded = await uploadLocalSnapshot(client, file)
    return { success: true, action: 'uploaded' as const, data: uploaded }
  }

  const remoteData = await loadRemoteSnapshot(client)
  if (!remoteData) {
    return { success: false, error: '云端没有可用数据' }
  }

  const appliedRemote = await applyRemoteSnapshot(client, file, remoteData)
  return { success: true, action: 'downloaded' as const, data: appliedRemote }
}

ipcMain.handle('webdav-test', async (_event, config: { server: string; username: string; password: string }) => {
  try {
    const client = await getWebDAVClient(config)
    await client.getDirectoryContents('/')
    await ensureRemoteDir(client)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('webdav-upload', async (_event, config: { server: string; username: string; password: string }) => {
  return enqueueWebDAVSync(async () => {
    try {
      const { dataFile: file } = getDataPaths()
      if (!fs.existsSync(file)) return { success: false, error: 'No data file' }
      const client = await getWebDAVClient(config)
      await uploadLocalSnapshot(client, file)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
})

ipcMain.handle('webdav-download', async (_event, config: { server: string; username: string; password: string }) => {
  return enqueueWebDAVSync(async () => {
    try {
      const client = await getWebDAVClient(config)
      if (!await client.exists(WEBDAV_REMOTE_FILE)) {
        return { success: true, data: null }
      }
      const raw = await client.getFileContents(WEBDAV_REMOTE_FILE, { format: 'text' })
      const data = JSON.parse(raw as string)
      await downloadRemoteImages(client)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
})

ipcMain.handle('webdav-auto-sync', async (_event, config: { server: string; username: string; password: string }) => {
  return enqueueWebDAVSync(async () => {
    try {
      const result = await reconcileWebDAVState(config)
      if (result.action === 'needs-confirmation') {
        mainWindow?.webContents.send('sync-status', { status: 'warning' })
        return result
      }
      mainWindow?.webContents.send('sync-status', { status: 'success' })
      return result
    } catch (err) {
      mainWindow?.webContents.send('sync-status', { status: 'error', error: String(err) })
      return { success: false, error: String(err) }
    }
  })
})

ipcMain.handle('webdav-startup-sync', async (_event, config: { server: string; username: string; password: string }) => {
  return enqueueWebDAVSync(async () => {
    try {
      return await reconcileWebDAVState(config)
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
})

ipcMain.handle('webdav-periodic-sync', async (_event, config: { server: string; username: string; password: string }) => {
  return enqueueWebDAVSync(async () => {
    try {
      return await reconcileWebDAVState(config)
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
})

ipcMain.handle('webdav-resolve-conflict', async (_event, config: { server: string; username: string; password: string }, resolution: SyncResolution) => {
  return enqueueWebDAVSync(async () => {
    try {
      const result = await resolveWebDAVConflict(config, resolution)
      if (result.success) {
        mainWindow?.webContents.send('sync-status', { status: 'success' })
      }
      return result
    } catch (err) {
      mainWindow?.webContents.send('sync-status', { status: 'error', error: String(err) })
      return { success: false, error: String(err) }
    }
  })
})

ipcMain.handle('get-platform', () => process.platform)

/* ===== Backup / Restore / Clear ===== */

function getBackupDir(): string {
  if (process.platform === 'darwin') {
    return path.join(app.getPath('documents'), 'FloatAnchor-Backups')
  }
  return path.join(app.getPath('documents'), 'FloatAnchor-Backups')
}

const CLEAR_RECENT_BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000

function listBackupArchives() {
  const backupDir = getBackupDir()
  if (!fs.existsSync(backupDir)) return []

  return fs.readdirSync(backupDir)
    .filter((fileName) => fileName.endsWith('.zip') && fileName.startsWith('FloatAnchor-backup-'))
    .map((fileName) => {
      const fullPath = path.join(backupDir, fileName)
      const stat = fs.statSync(fullPath)
      return { fileName, fullPath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function getBackupStatus() {
  const backupDir = getBackupDir()
  const backups = listBackupArchives()
  const latest = backups[0]
  const hasRecentBackup = !!latest && Date.now() - latest.mtimeMs <= CLEAR_RECENT_BACKUP_MAX_AGE_MS

  return {
    exists: backups.length > 0,
    count: backups.length,
    dir: backupDir,
    latestFileName: latest?.fileName,
    latestTimestamp: latest?.mtimeMs,
    hasRecentBackup,
  }
}

async function exportBackupArchive() {
  try {
    const { dataFile: file, dataDir: dir } = getDataPaths()
    if (!fs.existsSync(file)) {
      return { success: false, error: '没有找到数据文件' }
    }

    const backupDir = getBackupDir()
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const zipName = `FloatAnchor-backup-${ts}.zip`
    const zipPath = path.join(backupDir, zipName)

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => resolve())
      archive.on('error', (err) => reject(err))

      archive.pipe(output)
      archive.file(file, { name: 'float-anchor.json' })

      const imagesDir = path.join(dir, 'images')
      if (fs.existsSync(imagesDir)) {
        archive.directory(imagesDir, 'images')
      }

      archive.finalize()
    })

    return { success: true, path: zipPath, fileName: zipName }
  } catch (err) {
    console.error('Export backup failed:', err)
    return { success: false, error: String(err) }
  }
}

async function ensureRecentBackupForClear() {
  const status = getBackupStatus()
  if (status.hasRecentBackup) {
    return { success: true, backupCreated: false, ...status }
  }

  const backupRes = await exportBackupArchive()
  if (!backupRes.success) {
    return { success: false, error: backupRes.error || '清空前自动备份失败', ...status }
  }

  return {
    success: true,
    backupCreated: true,
    ...getBackupStatus(),
  }
}

ipcMain.handle('get-backup-dir', () => getBackupDir())

ipcMain.handle('export-backup', async () => {
  return exportBackupArchive()
})

ipcMain.handle('import-backup', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择备份文件',
      filters: [{ name: 'FloatAnchor Backup', extensions: ['zip'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'cancelled' }
    }

    const zipPath = result.filePaths[0]
    const zip = new AdmZip(zipPath)
    const dataEntry = zip.getEntry('float-anchor.json')
    if (!dataEntry) {
      return { success: false, error: '无效的备份文件：缺少 float-anchor.json' }
    }

    const importedRaw = zip.readAsText(dataEntry)
    const importedData = JSON.parse(importedRaw)

    if (!importedData.canvases || !Array.isArray(importedData.canvases)) {
      return { success: false, error: '无效的备份文件：数据格式不正确' }
    }

    const { dataFile: file, dataDir: dir } = getDataPaths()
    ensureDataDir()

    let existingData: any = { canvases: [], activeCanvasId: null }
    if (fs.existsSync(file)) {
      try {
        existingData = JSON.parse(fs.readFileSync(file, 'utf-8'))
      } catch {}
    }

    const existingCanvasMap = new Map<string, any>()
    for (const c of existingData.canvases || []) {
      existingCanvasMap.set(c.id, c)
    }

    for (const importedCanvas of importedData.canvases) {
      const existing = existingCanvasMap.get(importedCanvas.id)
      if (existing) {
        const existingCardMap = new Map<string, any>()
        for (const card of existing.cards || []) existingCardMap.set(card.id, card)
        for (const card of importedCanvas.cards || []) existingCardMap.set(card.id, card)
        existing.cards = Array.from(existingCardMap.values())

        const existingLabelMap = new Map<string, any>()
        for (const l of existing.labels || []) existingLabelMap.set(l.id, l)
        for (const l of importedCanvas.labels || []) existingLabelMap.set(l.id, l)
        existing.labels = Array.from(existingLabelMap.values())

        const existingSectionMap = new Map<string, any>()
        for (const s of existing.sections || []) existingSectionMap.set(s.id, s)
        for (const s of importedCanvas.sections || []) existingSectionMap.set(s.id, s)
        existing.sections = Array.from(existingSectionMap.values())

        const existingConnMap = new Map<string, any>()
        for (const cn of existing.connections || []) existingConnMap.set(cn.id, cn)
        for (const cn of importedCanvas.connections || []) existingConnMap.set(cn.id, cn)
        existing.connections = Array.from(existingConnMap.values())

        if (importedCanvas.viewport) existing.viewport = importedCanvas.viewport
        if (importedCanvas.name) existing.name = importedCanvas.name

        existingCanvasMap.set(importedCanvas.id, existing)
      } else {
        existingCanvasMap.set(importedCanvas.id, importedCanvas)
      }
    }

    const mergedData = {
      canvases: Array.from(existingCanvasMap.values()),
      activeCanvasId: importedData.activeCanvasId || existingData.activeCanvasId,
    }

    fs.writeFileSync(file, JSON.stringify(mergedData, null, 2), 'utf-8')

    const imagesDir = path.join(dir, 'images')
    const imageEntries = zip.getEntries().filter((e) => e.entryName.startsWith('images/') && !e.isDirectory)
    if (imageEntries.length > 0) {
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
      for (const entry of imageEntries) {
        const fileName = path.basename(entry.entryName)
        const destPath = path.join(imagesDir, fileName)
        fs.writeFileSync(destPath, entry.getData())
      }
    }

    return { success: true, data: mergedData }
  } catch (err) {
    console.error('Import backup failed:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('check-backup-exists', async () => {
  try {
    return getBackupStatus()
  } catch {
    return { exists: false }
  }
})

ipcMain.handle('prepare-clear-all-data', async () => {
  try {
    return await ensureRecentBackupForClear()
  } catch (err) {
    console.error('Prepare clear all data failed:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('clear-all-data', async () => {
  try {
    const backupRes = await ensureRecentBackupForClear()
    if (!backupRes.success) {
      return { success: false, error: backupRes.error || '清空前自动备份失败' }
    }

    const { dataFile: file } = getDataPaths()
    const emptyData = {
      canvases: [],
      activeCanvasId: null,
    }
    ensureDataDir()
    fs.writeFileSync(file, JSON.stringify(emptyData, null, 2), 'utf-8')
    return { success: true, data: emptyData }
  } catch (err) {
    console.error('Clear all data failed:', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.on('win-minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize()
})

ipcMain.on('win-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win?.isMaximized()) {
    win.unmaximize()
  } else {
    win?.maximize()
  }
})

ipcMain.on('win-close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close()
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'fa-image', privileges: { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, stream: true } },
  { scheme: 'fa-img', privileges: { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, stream: true } },
])

app.whenReady().then(() => {
  protocol.handle('fa-image', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname)
      if (!fs.existsSync(filePath)) {
        const storedImageName = extractStoredImageName(filePath)
        const storedImagePath = storedImageName ? resolveStoredImagePath(storedImageName) : null
        if (storedImagePath) {
          return net.fetch(pathToFileURL(storedImagePath).href)
        }
      }
      return net.fetch(pathToFileURL(filePath).href)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  protocol.handle('fa-img', (request) => {
    try {
      const url = new URL(request.url)
      const fileName = decodeURIComponent(url.pathname).replace(/^\/+/, '') || url.hostname
      const filePath = resolveStoredImagePath(fileName)
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).href)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  createWindow()
  startUpdateChecker()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
