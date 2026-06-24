import { describe, it, expect } from 'vitest'
import {
  summarizeSyncData, hasMeaningfulSyncData, isHighRiskRemoteOverwrite, buildSyncDecision,
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
