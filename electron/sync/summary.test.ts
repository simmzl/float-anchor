import { describe, it, expect } from 'vitest'
import {
  summarizeSyncData, hasMeaningfulSyncData, isHighRiskRemoteOverwrite, buildSyncDecision, formatSyncSummary,
  getComparableSyncSnapshot, stripDeviceLocalState,
} from './summary'

const canvas = (over: any = {}) => ({ id: 'c1', name: 'C', cards: [], ...over })

describe('summarizeSyncData', () => {
  it('counts cards/labels/sections/connections/texts', () => {
    const s = summarizeSyncData({ canvases: [canvas({
      cards: [{}, {}], labels: [{}], sections: [{}], connections: [{}], texts: [{}, {}, {}],
    })], activeCanvasId: 'c1' })
    expect(s.cardCount).toBe(2)
    expect(s.textCount).toBe(3)
  })
})

describe('hasMeaningfulSyncData (现状)', () => {
  it('单画布纯卡片为有意义', () => {
    expect(hasMeaningfulSyncData(summarizeSyncData({ canvases: [canvas({ cards: [{}] })], activeCanvasId: 'c1' }))).toBe(true)
  })
  it('空画布为无意义', () => {
    expect(hasMeaningfulSyncData(summarizeSyncData({ canvases: [canvas()], activeCanvasId: 'c1' }))).toBe(false)
  })
})

describe('isHighRiskRemoteOverwrite', () => {
  it('本地有数据、远端为空 → 高危', () => {
    const local = summarizeSyncData({ canvases: [canvas({ cards: [{}, {}] })] })
    const remote = summarizeSyncData({ canvases: [] })
    expect(isHighRiskRemoteOverwrite(local, remote)).toBe(true)
  })
})

describe('buildSyncDecision', () => {
  it('remote-newer 非高危给低危文案', () => {
    const local = { canvases: [canvas({ cards: [{}] })], _syncTimestamp: 1 }
    const remote = { canvases: [canvas({ cards: [{}, {}] })], _syncTimestamp: 2 }
    const d = buildSyncDecision(local, remote, 'remote-newer')
    expect(d.risk).toBe('low')
    expect(d.reason).toBe('remote-newer')
  })
})

describe('texts 纳入保护（Task 3）', () => {
  const canvas = (over: any = {}) => ({ id: 'c1', name: 'C', cards: [], ...over })

  it('只有文本框的单画布应为有意义数据', () => {
    const s = summarizeSyncData({ canvases: [canvas({ texts: [{}, {}] })], activeCanvasId: 'c1' })
    expect(hasMeaningfulSyncData(s)).toBe(true)
  })

  it('本地仅文本框、远端为空 → 高危覆盖', () => {
    const local = summarizeSyncData({ canvases: [canvas({ texts: [{}, {}, {}] })] })
    const remote = summarizeSyncData({ canvases: [] })
    expect(isHighRiskRemoteOverwrite(local, remote)).toBe(true)
  })

  it('formatSyncSummary 含文本框数量', () => {
    const s = summarizeSyncData({ canvases: [canvas({ texts: [{}] })] })
    expect(formatSyncSummary(s)).toContain('文本框')
  })
})

describe('getComparableSyncSnapshot — 设备本地状态不参与指纹', () => {
  const base = () => ({
    canvases: [canvas({
      cards: [{ id: 'k1', title: 'A', x: 0, y: 0, width: 300, height: 150 }],
      texts: [{ id: 't1', text: 'T', x: 0, y: 0, width: 200, height: 40 }],
      sections: [{ id: 's1', name: 'S', x: 0, y: 0, width: 600, height: 400, color: '#fff' }],
      viewport: { panX: 0, panY: 0, scale: 1 },
    })],
    activeCanvasId: 'c1',
  })

  it('仅 viewport 不同 → 指纹一致', () => {
    const a = base()
    const b = base()
    b.canvases[0].viewport = { panX: 500, panY: -200, scale: 2 }
    expect(getComparableSyncSnapshot(a)).toBe(getComparableSyncSnapshot(b))
  })

  it('一方无 viewport、另一方有 → 指纹一致', () => {
    const a = base()
    const b = base()
    delete (b.canvases[0] as any).viewport
    expect(getComparableSyncSnapshot(a)).toBe(getComparableSyncSnapshot(b))
  })

  it('仅卡片测量高度不同 → 指纹一致', () => {
    const a = base()
    const b = base()
    b.canvases[0].cards[0].height = 153
    expect(getComparableSyncSnapshot(a)).toBe(getComparableSyncSnapshot(b))
  })

  it('仅文本框测量高度不同 → 指纹一致', () => {
    const a = base()
    const b = base()
    b.canvases[0].texts[0].height = 44
    expect(getComparableSyncSnapshot(a)).toBe(getComparableSyncSnapshot(b))
  })

  it('分区高度不同（用户拖拽的真实尺寸）→ 指纹不同', () => {
    const a = base()
    const b = base()
    b.canvases[0].sections[0].height = 500
    expect(getComparableSyncSnapshot(a)).not.toBe(getComparableSyncSnapshot(b))
  })

  it('卡片内容不同 → 指纹不同（防误伤）', () => {
    const a = base()
    const b = base()
    b.canvases[0].cards[0].title = 'B'
    expect(getComparableSyncSnapshot(a)).not.toBe(getComparableSyncSnapshot(b))
  })
})

describe('stripDeviceLocalState — 上传前剥离视口', () => {
  it('移除各画布 viewport，其余字段与卡片高度保留', () => {
    const data = {
      canvases: [
        canvas({ cards: [{ id: 'k1', height: 150 }], viewport: { panX: 1, panY: 2, scale: 1.5 } }),
        canvas({ id: 'c2' }),
      ],
      activeCanvasId: 'c1',
      _syncTimestamp: 7,
    }
    const stripped = stripDeviceLocalState(data as any)
    expect(stripped.canvases[0].viewport).toBeUndefined()
    expect('viewport' in stripped.canvases[0]).toBe(false)
    expect(stripped.canvases[0].cards[0].height).toBe(150)
    expect(stripped.canvases[1].id).toBe('c2')
    expect(stripped._syncTimestamp).toBe(7)
    // 原对象不被修改
    expect((data.canvases[0] as any).viewport).toEqual({ panX: 1, panY: 2, scale: 1.5 })
  })
})
