import { describe, it, expect } from 'vitest'
import { snapshotCanvas, contentFingerprint, applySnapshot } from './history'
import type { Canvas } from './types'

const mkCanvas = (over: Partial<Canvas> = {}): Canvas => ({
  id: 'cv', name: 'cv',
  cards: [{ id: 'c1', title: 't', content: '', x: 1, y: 2, width: 300 }],
  texts: [], labels: [], sections: [], connections: [], ...over,
})

describe('contentFingerprint', () => {
  it('忽略 viewport 变化', () => {
    const a = mkCanvas({ viewport: { panX: 0, panY: 0, scale: 1 } })
    const b = mkCanvas({ viewport: { panX: 999, panY: 999, scale: 2 } })
    expect(contentFingerprint(a)).toBe(contentFingerprint(b))
  })
  it('内容变化会改变指纹', () => {
    const a = mkCanvas()
    const b = mkCanvas({ cards: [{ id: 'c1', title: 'X', content: '', x: 1, y: 2, width: 300 }] })
    expect(contentFingerprint(a)).not.toBe(contentFingerprint(b))
  })
})

describe('snapshotCanvas 深拷贝', () => {
  it('改原画布不影响快照', () => {
    const cv = mkCanvas()
    const snap = snapshotCanvas(cv)
    cv.cards[0].title = 'MUT'
    expect(snap.cards[0].title).toBe('t')
  })
})

describe('applySnapshot', () => {
  it('替换内容但保留 id/name/viewport', () => {
    const cv = mkCanvas({ viewport: { panX: 5, panY: 6, scale: 1.5 } })
    const snap = snapshotCanvas(mkCanvas({ cards: [] }))
    const out = applySnapshot(cv, snap)
    expect(out.id).toBe('cv')
    expect(out.name).toBe('cv')
    expect(out.viewport).toEqual({ panX: 5, panY: 6, scale: 1.5 })
    expect(out.cards).toEqual([])
  })
})
