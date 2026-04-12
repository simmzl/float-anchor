import { useEffect, useState, useRef, useCallback } from 'react'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import CanvasView from './components/CanvasView'
import SettingsModal from './components/SettingsModal'
import type { WebDAVConfig } from './types'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 400
const SIDEBAR_DEFAULT = 228
const BACKGROUND_SYNC_INTERVAL_MS = 10000

export default function App() {
  const { loaded, loadData, loadSettings } = useStore()
  const showSettings = useStore((s) => s.showSettings)
  const webdavConfig = useStore((s) => s.settings.webdav)
  const [platform, setPlatform] = useState<string>('darwin')
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const dragging = useRef(false)
  const backgroundSyncingRef = useRef(false)
  const backgroundStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX))
      setSidebarWidth(w)
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    let disposed = false

    const bootstrap = async () => {
      await loadSettings()
      if (disposed) return

      // Never block the first screen on remote sync.
      await loadData()
      if (disposed) return

      const { settings } = useStore.getState()
      if (!settings.webdav?.server) return

      try {
        useStore.getState().setSyncStatus('syncing')
        const res = await window.electronAPI.webdavStartupSync(settings.webdav)
        if (disposed) return

        if (!res.success) {
          useStore.getState().setSyncStatus('error')
          return
        }

        if (res.action === 'downloaded' && res.data) {
          await useStore.getState().loadData()
          if (disposed) return
        }

        if (res.action === 'uploaded' || res.action === 'downloaded') {
          useStore.getState().setSyncStatus('success')
          if (backgroundStatusTimerRef.current) clearTimeout(backgroundStatusTimerRef.current)
          backgroundStatusTimerRef.current = setTimeout(() => {
            if (useStore.getState().syncStatus === 'success') {
              useStore.getState().setSyncStatus('idle')
            }
          }, 3000)
          return
        }

        useStore.getState().setSyncStatus('idle')
      } catch {
        if (!disposed) useStore.getState().setSyncStatus('error')
      }
    }

    void bootstrap()
    window.electronAPI.getPlatform().then(setPlatform)

    return () => {
      disposed = true
    }
  }, [loadData, loadSettings])

  const runBackgroundSync = useCallback(async (config: WebDAVConfig) => {
    if (backgroundSyncingRef.current) return
    backgroundSyncingRef.current = true
    try {
      const res = await window.electronAPI.webdavPeriodicSync(config)
      const store = useStore.getState()
      if (res.success && res.action === 'downloaded' && res.data) {
        await store.loadData()
      }
      if (!res.success) {
        store.setSyncStatus('error')
        return
      }
      if (res.action === 'uploaded' || res.action === 'downloaded') {
        store.setSyncStatus('success')
        if (backgroundStatusTimerRef.current) clearTimeout(backgroundStatusTimerRef.current)
        backgroundStatusTimerRef.current = setTimeout(() => {
          if (useStore.getState().syncStatus === 'success') {
            useStore.getState().setSyncStatus('idle')
          }
        }, 3000)
      }
    } catch {
      useStore.getState().setSyncStatus('error')
    } finally {
      backgroundSyncingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!webdavConfig?.server) return
    const timer = window.setInterval(() => {
      void runBackgroundSync(webdavConfig)
    }, BACKGROUND_SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [runBackgroundSync, webdavConfig?.server, webdavConfig?.username, webdavConfig?.password])

  useEffect(() => {
    return () => {
      if (backgroundStatusTimerRef.current) clearTimeout(backgroundStatusTimerRef.current)
    }
  }, [])

  if (!loaded) {
    return (
      <div className="app-loading">
        <span>加载中...</span>
      </div>
    )
  }

  return (
    <div className="app" data-platform={platform}>
      {platform === 'win32' && (
        <div className="win-titlebar">
          <span className="win-titlebar-title">FloatAnchor</span>
          <div className="win-titlebar-controls">
            <button onClick={() => window.electronAPI.winMinimize()}>
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>
            <button onClick={() => window.electronAPI.winMaximize()}>
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            </button>
            <button
              className="win-close"
              onClick={() => window.electronAPI.winClose()}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
                <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="app-body">
        <Sidebar width={sidebarWidth} />
        <div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
        <CanvasView />
      </div>
      {showSettings && <SettingsModal />}
    </div>
  )
}
