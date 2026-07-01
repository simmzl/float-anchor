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

import { afterEach, vi } from 'vitest'
import { initHistory } from './history'
import { useStore } from './store'
import type { AppSettings } from './types'

describe('initHistory 时间合并记录', () => {
  let dispose: (() => void) | undefined
  const mkCard = (id: string, x: number) => ({ id, title: id, content: '', x, y: 0, width: 300, height: 150 })

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
    historyStore.clear()
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{ id: 'cv', name: 'cv', cards: [{ ...mkCard('c1', 0), title: 'orig' }] }],
      settings: { theme: 'light' } as AppSettings,
      editingCardId: null, editingTextId: null,
      syncDecision: null, suppressHistory: false,
      clipboard: null, pasteCount: 0,
    })
  })
  afterEach(() => {
    dispose?.(); dispose = undefined
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('连续拖动合并为一条，undo 回到起点', () => {
    dispose = initHistory()
    useStore.getState().moveCard('c1', 5, 0)
    useStore.getState().moveCard('c1', 10, 0)
    useStore.getState().moveCard('c1', 15, 0)
    expect(historyStore.canUndo('cv')).toBe(true)
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].x).toBe(0)
    // 只有一条：再 undo 无效
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].x).toBe(0)
  })

  it('viewport 变化不记历史', () => {
    dispose = initHistory()
    useStore.getState().saveViewport('cv', { panX: 100, panY: 50, scale: 2 })
    expect(historyStore.canUndo('cv')).toBe(false)
  })

  it('编辑会话内多次更新合并为一条', () => {
    dispose = initHistory()
    useStore.getState().setEditingCard('c1')
    useStore.getState().updateCard('c1', { content: 'a' })
    vi.advanceTimersByTime(500)
    useStore.getState().updateCard('c1', { content: 'ab' })
    vi.advanceTimersByTime(500)
    useStore.getState().setEditingCard(null)
    vi.advanceTimersByTime(500)
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].content).toBe('')
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].content).toBe('')
  })

  it('suppressHistory 时不记录', () => {
    dispose = initHistory()
    useStore.setState({ suppressHistory: true })
    useStore.getState().updateCard('c1', { title: 'X' })
    expect(historyStore.canUndo('cv')).toBe(false)
  })

  it('粘贴是一条可撤销记录', () => {
    dispose = initHistory()
    useStore.getState().copySelection({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    useStore.getState().pasteClipboard()
    expect(useStore.getState().canvases[0].cards.length).toBe(2)
    vi.advanceTimersByTime(500)
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards.length).toBe(1)
  })

  it('undo 后立即操作不丢历史（flushBurst）', () => {
    dispose = initHistory()
    useStore.getState().updateCard('c1', { title: 'A' })   // 记一条(before=orig), burst 开
    useStore.getState().undo()                              // 撤销; flushBurst 清 burst
    expect(useStore.getState().canvases[0].cards[0].title).toBe('orig')
    useStore.getState().updateCard('c1', { title: 'B' })   // 仍在 400ms 内; 应记新一条
    expect(historyStore.canUndo('cv')).toBe(true)
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].title).toBe('orig')
  })

  it('拖动后立即粘贴，粘贴独立成一条（flushBurst）', () => {
    dispose = initHistory()
    useStore.getState().copySelection({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    useStore.getState().moveCard('c1', 20, 0)   // 记拖动一条(before: x=0), burst 开
    useStore.getState().pasteClipboard()         // flush → 粘贴独立成一条(before: c1 在 x=20)
    expect(useStore.getState().canvases[0].cards.length).toBe(2)
    useStore.getState().undo()                   // 只撤销粘贴
    const cv = useStore.getState().canvases[0]
    expect(cv.cards.length).toBe(1)
    expect(cv.cards[0].x).toBe(20)               // 拖动未被一起撤销
  })
})
