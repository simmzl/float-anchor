import { useStore, getEffectiveProvider } from '../store'

const META: Record<string, { dot: string; label: string }> = {
  idle:    { dot: 'connected', label: '已同步' },
  pending: { dot: 'pending',   label: '待同步' },
  syncing: { dot: 'syncing',   label: '同步中' },
  success: { dot: 'connected', label: '已同步' },
  error:   { dot: 'error',     label: '同步失败' },
  warning: { dot: 'warning',   label: '待确认' },
}

export default function SyncStatusIndicator() {
  const syncStatus = useStore((s) => s.syncStatus)
  const provider = useStore((s) => getEffectiveProvider(s.settings))
  if (provider === 'none') return null

  const meta = META[syncStatus] ?? META.idle
  const clickable = syncStatus === 'error' || syncStatus === 'warning'

  return (
    <button
      className={`sync-indicator${clickable ? ' clickable' : ''}`}
      title={`同步状态：${meta.label}`}
      onClick={clickable ? () => useStore.getState().setShowSettings(true) : undefined}
      disabled={!clickable}
    >
      <span className={`sync-dot ${meta.dot}`} />
      <span className="sync-indicator-label">{meta.label}</span>
    </button>
  )
}
