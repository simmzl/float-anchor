import { describe, it, expect } from 'vitest'
import { getEffectiveProvider } from './store'
import type { AppSettings } from './types'

describe('getEffectiveProvider', () => {
  it('无 syncProvider 但有 webdav.server → webdav（老用户兜底）', () => {
    const settings: AppSettings = { theme: 'light', webdav: { server: 'x', username: '', password: '' } }
    expect(getEffectiveProvider(settings)).toBe('webdav')
  })

  it('无 syncProvider 且无 webdav → none', () => {
    const settings: AppSettings = { theme: 'light' }
    expect(getEffectiveProvider(settings)).toBe('none')
  })

  it('显式 syncProvider=none 时，即使有 webdav.server 也返回 none', () => {
    const settings: AppSettings = { theme: 'light', syncProvider: 'none', webdav: { server: 'x', username: '', password: '' } }
    expect(getEffectiveProvider(settings)).toBe('none')
  })

  it('显式 syncProvider=onedrive → onedrive', () => {
    const settings: AppSettings = { theme: 'light', syncProvider: 'onedrive' }
    expect(getEffectiveProvider(settings)).toBe('onedrive')
  })
})
