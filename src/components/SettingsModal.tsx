import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../store'
import type { WebDAVConfig } from '../types'

export default function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const syncStatus = useStore((s) => s.syncStatus)
  const setTheme = useStore((s) => s.setTheme)
  const setWebDAVConfig = useStore((s) => s.setWebDAVConfig)
  const setShowSettings = useStore((s) => s.setShowSettings)

  const [backupStatus, setBackupStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle')
  const [backupMessage, setBackupMessage] = useState('')
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle')
  const [importMessage, setImportMessage] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearInput, setClearInput] = useState('')
  const [clearStatus, setClearStatus] = useState<'idle' | 'no-backup' | 'ready' | 'clearing' | 'done'>('idle')
  const [clearMessage, setClearMessage] = useState('')

  const CLEAR_CONFIRM_TEXT = '我已明确该操作会清空所有内容，执行'

  const handleExport = useCallback(async () => {
    setBackupStatus('exporting')
    setBackupMessage('')
    try {
      const res = await window.electronAPI.exportBackup()
      if (res.success) {
        setBackupStatus('success')
        setBackupMessage(`备份成功：${res.fileName}`)
        setTimeout(() => { setBackupStatus('idle'); setBackupMessage('') }, 5000)
      } else {
        setBackupStatus('error')
        setBackupMessage(res.error || '导出失败')
        setTimeout(() => { setBackupStatus('idle'); setBackupMessage('') }, 5000)
      }
    } catch {
      setBackupStatus('error')
      setBackupMessage('导出时发生错误')
      setTimeout(() => { setBackupStatus('idle'); setBackupMessage('') }, 5000)
    }
  }, [])

  const handleImport = useCallback(async () => {
    setImportStatus('importing')
    setImportMessage('')
    try {
      const res = await window.electronAPI.importBackup()
      if (res.success && res.data) {
        setImportStatus('success')
        setImportMessage('导入成功，正在重新加载数据...')
        await useStore.getState().loadData()
        setTimeout(() => { setImportStatus('idle'); setImportMessage('') }, 3000)
      } else if (res.error === 'cancelled') {
        setImportStatus('idle')
      } else {
        setImportStatus('error')
        setImportMessage(res.error || '导入失败')
        setTimeout(() => { setImportStatus('idle'); setImportMessage('') }, 5000)
      }
    } catch {
      setImportStatus('error')
      setImportMessage('导入时发生错误')
      setTimeout(() => { setImportStatus('idle'); setImportMessage('') }, 5000)
    }
  }, [])

  const handleClearClick = useCallback(async () => {
    setClearInput('')
    setClearMessage('')
    const res = await window.electronAPI.checkBackupExists()
    if (!res.exists) {
      setClearStatus('no-backup')
      setClearMessage('未检测到备份文件，请先导出备份后再执行清空操作。')
      setShowClearConfirm(true)
      return
    }
    setClearStatus('ready')
    setShowClearConfirm(true)
  }, [])

  const handleClearConfirm = useCallback(async () => {
    if (clearInput !== CLEAR_CONFIRM_TEXT) return
    setClearStatus('clearing')
    setClearMessage('')
    try {
      const res = await window.electronAPI.clearAllData()
      if (res.success) {
        setClearStatus('done')
        setClearMessage('所有数据已清空')
        await useStore.getState().loadData()
        setTimeout(() => {
          setShowClearConfirm(false)
          setClearStatus('idle')
          setClearMessage('')
          setClearInput('')
        }, 2000)
      } else {
        setClearStatus('ready')
        setClearMessage(res.error || '清空失败')
      }
    } catch {
      setClearStatus('ready')
      setClearMessage('清空时发生错误')
    }
  }, [clearInput])

  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'installing' | 'error'>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateInfo, setUpdateInfo] = useState<{ downloadUrl: string; assetName: string } | null>(null)
  const [currentVersion, setCurrentVersion] = useState('')
  const checkedRef = useRef(false)

  useEffect(() => {
    const unsub1 = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version)
      setUpdateInfo({ downloadUrl: info.downloadUrl, assetName: info.assetName })
      setCurrentVersion(info.currentVersion)
      const rp = (info as any).resumePercent ?? 0
      if (rp > 0 && rp < 100) {
        setUpdateStatus('downloading')
        setUpdateProgress(rp)
      } else if (rp >= 100) {
        setUpdateStatus('downloading')
        setUpdateProgress(100)
      } else {
        setUpdateStatus('available')
      }
    })
    const unsub2 = window.electronAPI.onUpdateProgress((p) => {
      if (p.stage === 'downloading') {
        setUpdateStatus('downloading')
        setUpdateProgress(p.percent)
      } else if (p.stage === 'installing') {
        setUpdateStatus('installing')
        setUpdateProgress(100)
      } else if (p.stage === 'error') {
        setUpdateStatus('error')
      }
    })
    return () => { unsub1(); unsub2() }
  }, [])

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true
    setUpdateStatus('checking')
    window.electronAPI.checkUpdate().then((res) => {
      setCurrentVersion(res.currentVersion)
      if (res.hasUpdate && res.version) {
        setUpdateVersion(res.version)
        setUpdateStatus((prev) => (prev === 'downloading' || prev === 'installing') ? prev : 'available')
      } else {
        setUpdateStatus((prev) => (prev === 'downloading' || prev === 'installing') ? prev : 'up-to-date')
      }
    }).catch(() => {
      setUpdateStatus((prev) => (prev === 'downloading' || prev === 'installing') ? prev : 'error')
    })
  }, [])

  const handleCheckUpdate = useCallback(() => {
    setUpdateStatus('checking')
    window.electronAPI.checkUpdate().then((res) => {
      setCurrentVersion(res.currentVersion)
      if (res.hasUpdate && res.version) {
        setUpdateVersion(res.version)
        setUpdateStatus('available')
      } else {
        setUpdateStatus('up-to-date')
      }
    }).catch(() => setUpdateStatus('error'))
  }, [])

  const handleStartUpdate = useCallback(() => {
    if (!updateInfo) return
    setUpdateStatus('downloading')
    setUpdateProgress(0)
    window.electronAPI.triggerUpdate(updateInfo.downloadUrl, updateInfo.assetName)
  }, [updateInfo])

  const [server, setServer] = useState(settings.webdav?.server || 'https://dav.jianguoyun.com/dav/')
  const [username, setUsername] = useState(settings.webdav?.username || '')
  const [password, setPassword] = useState(settings.webdav?.password || '')
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connected, setConnected] = useState(!!settings.webdav?.server)

  useEffect(() => {
    if (settings.webdav) {
      setServer(settings.webdav.server)
      setUsername(settings.webdav.username)
      setPassword(settings.webdav.password)
      setConnected(true)
    }
  }, [settings.webdav])

  const handleTest = useCallback(async () => {
    if (!server || !username || !password) return
    setTestResult('testing')
    const config: WebDAVConfig = { server, username, password }
    const res = await window.electronAPI.webdavTest(config)
    setTestResult(res.success ? 'ok' : 'fail')
    setTimeout(() => setTestResult('idle'), 3000)
  }, [server, username, password])

  const handleSave = useCallback(async () => {
    if (!server || !username || !password) return
    const config: WebDAVConfig = { server, username, password }
    const res = await window.electronAPI.webdavTest(config)
    if (res.success) {
      setWebDAVConfig(config)
      setConnected(true)
      setTestResult('ok')
      setTimeout(() => setTestResult('idle'), 2000)
      useStore.getState().setSyncStatus('syncing')
      window.electronAPI.webdavAutoSync(config).then((syncRes) => {
        useStore.getState().setSyncStatus(syncRes.success ? 'success' : 'error')
        if (syncRes.success) setTimeout(() => useStore.getState().setSyncStatus('idle'), 3000)
      }).catch(() => useStore.getState().setSyncStatus('error'))
    } else {
      setTestResult('fail')
      setTimeout(() => setTestResult('idle'), 3000)
    }
  }, [server, username, password, setWebDAVConfig])

  const handleManualSync = useCallback(async () => {
    const cfg = settings.webdav
    if (!cfg?.server) return
    const store = useStore.getState()
    store.setSyncStatus('syncing')
    try {
      store.persist()
      await new Promise((r) => setTimeout(r, 500))
      const res = await window.electronAPI.webdavStartupSync(cfg)
      if (res.success && res.action === 'downloaded' && res.data) {
        await store.loadData()
      }
      store.setSyncStatus(res.success ? 'success' : 'error')
      if (res.success) setTimeout(() => useStore.getState().setSyncStatus('idle'), 3000)
    } catch {
      store.setSyncStatus('error')
    }
  }, [settings.webdav])

  const handleDisconnect = useCallback(() => {
    setWebDAVConfig(undefined)
    setConnected(false)
    setUsername('')
    setPassword('')
    setTestResult('idle')
  }, [setWebDAVConfig])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setShowSettings(false)
  }

  const syncLabel = syncStatus === 'syncing'
    ? '同步中...'
    : syncStatus === 'success'
    ? '已同步'
    : syncStatus === 'error'
    ? '同步失败'
    : connected ? '已连接' : '未连接'

  const syncDotClass = syncStatus === 'syncing'
    ? 'syncing'
    : syncStatus === 'error'
    ? 'error'
    : connected ? 'connected' : ''

  return (
    <div className="settings-overlay" onClick={handleOverlayClick}>
      <div className="settings-modal">
        <h2>设置</h2>

        <div className="settings-section">
          <h3>外观</h3>
          <div className="theme-switcher">
            <button
              className={`theme-option ${settings.theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme('light')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              Light
            </button>
            <button
              className={`theme-option ${settings.theme === 'dark' ? 'active' : ''}`}
              onClick={() => setTheme('dark')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              Dark
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>软件更新</h3>
          <div className="update-section">
            <div className="update-version-row">
              <span className="update-current">当前版本：v{currentVersion || '...'}</span>
              {updateVersion && updateStatus !== 'up-to-date' && (
                <span className="update-new-badge">v{updateVersion} 可用</span>
              )}
            </div>

            {(updateStatus === 'downloading' || updateStatus === 'installing') && (
              <div className="update-settings-progress">
                <div className="update-progress-bar">
                  <div className="update-progress-fill" style={{ width: `${updateProgress}%` }} />
                </div>
                <span className="update-progress-label">
                  {updateStatus === 'installing' ? '安装中...' : `下载中 ${updateProgress}%`}
                </span>
              </div>
            )}

            <div className="update-settings-actions">
              <button
                onClick={handleCheckUpdate}
                disabled={updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'installing'}
              >
                {updateStatus === 'checking' ? '检查中...' : updateStatus === 'up-to-date' ? '已是最新版本' : '检查更新'}
              </button>
              {updateStatus === 'available' && updateInfo && (
                <button className="primary" onClick={handleStartUpdate}>
                  更新到 v{updateVersion}
                </button>
              )}
              {updateStatus === 'error' && (
                <span className="update-error-hint">检查更新失败，请稍后再试</span>
              )}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>云同步 — 坚果云 (WebDAV)</h3>
          <div className="webdav-form">
            <div className="webdav-field">
              <label>服务器地址</label>
              <input
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav/"
              />
            </div>
            <div className="webdav-field">
              <label>账号（邮箱）</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your@email.com"
              />
            </div>
            <div className="webdav-field">
              <label>应用密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="在坚果云后台生成"
              />
            </div>
            <div className="webdav-actions">
              <button onClick={handleTest} disabled={testResult === 'testing'}>
                {testResult === 'testing' ? '测试中...' : testResult === 'ok' ? '连接成功' : testResult === 'fail' ? '连接失败' : '测试连接'}
              </button>
              <button className="primary" onClick={handleSave}>保存</button>
              {connected && (
                <>
                  <button onClick={handleManualSync} disabled={syncStatus === 'syncing'}>
                    {syncStatus === 'syncing' ? '同步中...' : '同步'}
                  </button>
                  <button onClick={handleDisconnect}>断开</button>
                </>
              )}
            </div>
            <div className="sync-status">
              <span className={`sync-dot ${syncDotClass}`} />
              <span>{syncLabel}</span>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>数据管理</h3>
          <div className="data-management">
            <div className="data-management-row">
              <div className="data-management-item">
                <button
                  className="data-btn export-btn"
                  onClick={handleExport}
                  disabled={backupStatus === 'exporting'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {backupStatus === 'exporting' ? '导出中...' : '导出备份'}
                </button>
                <span className="data-hint">将所有数据导出为压缩包备份</span>
              </div>
              <div className="data-management-item">
                <button
                  className="data-btn import-btn"
                  onClick={handleImport}
                  disabled={importStatus === 'importing'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {importStatus === 'importing' ? '导入中...' : '导入备份'}
                </button>
                <span className="data-hint">从备份文件恢复数据</span>
              </div>
            </div>
            {backupMessage && (
              <div className={`data-message ${backupStatus === 'error' ? 'error' : 'success'}`}>
                {backupMessage}
              </div>
            )}
            {importMessage && (
              <div className={`data-message ${importStatus === 'error' ? 'error' : 'success'}`}>
                {importMessage}
              </div>
            )}
            <div className="data-management-danger">
              <button
                className="data-btn danger-btn"
                onClick={handleClearClick}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                清空所有数据
              </button>
              <span className="data-hint danger-hint">此操作不可恢复，请谨慎操作</span>
            </div>
          </div>
        </div>

        {showClearConfirm && (
          <div className="clear-confirm-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowClearConfirm(false); setClearStatus('idle'); setClearMessage(''); setClearInput('') } }}>
            <div className="clear-confirm-modal">
              <h3>清空所有数据</h3>
              {clearStatus === 'no-backup' ? (
                <div className="clear-warning">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{clearMessage}</span>
                </div>
              ) : (
                <>
                  <p className="clear-desc">此操作将永久删除所有画布、卡片、标题、分区和连线数据。请输入以下文字确认：</p>
                  <p className="clear-confirm-text">{CLEAR_CONFIRM_TEXT}</p>
                  <input
                    className="clear-input"
                    value={clearInput}
                    onChange={(e) => setClearInput(e.target.value)}
                    placeholder="请输入上方文字以确认"
                    disabled={clearStatus === 'clearing' || clearStatus === 'done'}
                  />
                  {clearMessage && (
                    <div className={`data-message ${clearStatus === 'done' ? 'success' : 'error'}`}>
                      {clearMessage}
                    </div>
                  )}
                  <div className="clear-confirm-actions">
                    <button onClick={() => { setShowClearConfirm(false); setClearStatus('idle'); setClearMessage(''); setClearInput('') }}>
                      取消
                    </button>
                    <button
                      className="danger-btn"
                      disabled={clearInput !== CLEAR_CONFIRM_TEXT || clearStatus === 'clearing' || clearStatus === 'done'}
                      onClick={handleClearConfirm}
                    >
                      {clearStatus === 'clearing' ? '清空中...' : clearStatus === 'done' ? '已清空' : '确认清空'}
                    </button>
                  </div>
                </>
              )}
              {clearStatus === 'no-backup' && (
                <div className="clear-confirm-actions">
                  <button onClick={() => { setShowClearConfirm(false); setClearStatus('idle'); setClearMessage('') }}>
                    我知道了
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="settings-footer">
          <button onClick={() => setShowSettings(false)}>关闭</button>
        </div>
      </div>
    </div>
  )
}
