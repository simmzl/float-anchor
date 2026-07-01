import { describe, it, expect, beforeEach } from 'vitest'
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

import { historyStore } from './history'

const snap = (title: string): import('./history').CanvasSnapshot =>
  ({ cards: [{ id: 'c1', title, content: '', x: 0, y: 0, width: 300 }], texts: [], labels: [], sections: [], connections: [] })

describe('historyStore', () => {
  beforeEach(() => historyStore.clear())

  it('record 压入 undo 并清空 redo', () => {
    historyStore.record('cv', snap('A'))
    expect(historyStore.canUndo('cv')).toBe(true)
    expect(historyStore.canRedo('cv')).toBe(false)
  })

  it('undo 返回上一份并把当前压入 redo', () => {
    historyStore.record('cv', snap('A'))
    const got = historyStore.undo('cv', snap('B'))
    expect(got?.cards[0].title).toBe('A')
    expect(historyStore.canRedo('cv')).toBe(true)
    expect(historyStore.canUndo('cv')).toBe(false)
  })

  it('redo 返回被撤销的那份', () => {
    historyStore.record('cv', snap('A'))
    historyStore.undo('cv', snap('B'))
    const got = historyStore.redo('cv', snap('A'))
    expect(got?.cards[0].title).toBe('B')
  })

  it('undo 栈上限 50', () => {
    for (let i = 0; i < 60; i++) historyStore.record('cv', snap(String(i)))
    let count = 0
    while (historyStore.undo('cv', snap('x'))) count++
    expect(count).toBe(50)
  })

  it('画布间历史相互隔离', () => {
    historyStore.record('cv1', snap('A'))
    expect(historyStore.canUndo('cv2')).toBe(false)
    historyStore.clearCanvas('cv1')
    expect(historyStore.canUndo('cv1')).toBe(false)
  })
})
