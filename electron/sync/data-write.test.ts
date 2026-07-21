import { describe, it, expect } from 'vitest'
import { isSameSyncContent, prepareDataWrite } from './data-write'

const mkData = (title: string, ts?: number) => ({
  canvases: [{ id: 'cv', name: 'cv', cards: [{ id: 'c1', title }] }],
  activeCanvasId: 'cv',
  ...(ts != null ? { _syncTimestamp: ts } : {}),
})

describe('isSameSyncContent（只比对 canvases+activeCanvasId，忽略 _syncTimestamp）', () => {
  it('内容相同、仅时间戳不同 → true', () => {
    expect(isSameSyncContent(mkData('A', 1), mkData('A', 999))).toBe(true)
  })
  it('canvases 不同 → false', () => {
    expect(isSameSyncContent(mkData('A', 1), mkData('B', 1))).toBe(false)
  })
  it('activeCanvasId 不同 → false', () => {
    const a = mkData('A')
    const b = { ...mkData('A'), activeCanvasId: 'other' }
    expect(isSameSyncContent(a, b)).toBe(false)
  })
})

describe('prepareDataWrite（写盘前：回填时间戳 + 判断是否需要写）', () => {
  const existing = mkData('A', 12345)

  it('内容未变（渲染层不带时间戳）→ changed=false，且回填已有时间戳', () => {
    const incoming = { canvases: existing.canvases, activeCanvasId: 'cv' }
    const r = prepareDataWrite(incoming, existing)
    expect(r.changed).toBe(false)
    expect(r.data._syncTimestamp).toBe(12345)
  })

  it('内容变了 → changed=true', () => {
    const incoming = { canvases: mkData('B').canvases, activeCanvasId: 'cv' }
    const r = prepareDataWrite(incoming, existing)
    expect(r.changed).toBe(true)
  })

  it('磁盘无已有文件（existing=null）→ changed=true（首次必写）', () => {
    const incoming = { canvases: existing.canvases, activeCanvasId: 'cv' }
    const r = prepareDataWrite(incoming, null)
    expect(r.changed).toBe(true)
  })

  it('incoming 自带 _syncTimestamp → 不被 existing 覆盖', () => {
    const incoming = { canvases: existing.canvases, activeCanvasId: 'cv', _syncTimestamp: 88888 }
    const r = prepareDataWrite(incoming, existing)
    expect(r.data._syncTimestamp).toBe(88888)
  })
})

describe('设备本地状态不触发写盘（视口/测量高度回归锁）', () => {
  it('仅 viewport 变化 → changed=false（平移缩放不触发同步）', () => {
    const existing = {
      canvases: [{ id: 'cv', name: 'cv', cards: [], viewport: { panX: 0, panY: 0, scale: 1 } }],
      activeCanvasId: 'cv', _syncTimestamp: 1,
    }
    const incoming = {
      canvases: [{ id: 'cv', name: 'cv', cards: [], viewport: { panX: 500, panY: -200, scale: 2 } }],
      activeCanvasId: 'cv',
    }
    expect(prepareDataWrite(incoming, existing).changed).toBe(false)
  })

  it('仅卡片测量高度变化 → changed=false（跨设备渲染差异不触发同步）', () => {
    const existing = {
      canvases: [{ id: 'cv', name: 'cv', cards: [{ id: 'c1', title: 'A', height: 150 }] }],
      activeCanvasId: 'cv', _syncTimestamp: 1,
    }
    const incoming = {
      canvases: [{ id: 'cv', name: 'cv', cards: [{ id: 'c1', title: 'A', height: 153 }] }],
      activeCanvasId: 'cv',
    }
    expect(prepareDataWrite(incoming, existing).changed).toBe(false)
  })
})
