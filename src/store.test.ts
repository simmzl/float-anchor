import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getEffectiveProvider, isCardSnappedAdjacent, useStore } from './store'
import type { AppSettings, Card, Section } from './types'
import { historyStore, snapshotCanvas } from './history'

describe('isCardSnappedAdjacent（拖拽贴靠分区成员的判定）', () => {
  const GAP = 12
  const A = { x: 0, y: 100, width: 200, height: 150 } // 成员：x∈[0,200] y∈[100,250]

  // —— 合法相邻：必须仍为 true（防止"漏吸附"回归） ——
  it('右邻：带 GAP、同一行 → true', () => {
    expect(isCardSnappedAdjacent({ x: 212, y: 100, width: 200, height: 150 }, A, GAP)).toBe(true)
  })
  it('左邻：带 GAP、同一行 → true', () => {
    expect(isCardSnappedAdjacent({ x: -212, y: 100, width: 200, height: 150 }, A, GAP)).toBe(true)
  })
  it('右邻：同一行但只部分纵向重叠 → true', () => {
    expect(isCardSnappedAdjacent({ x: 212, y: 180, width: 200, height: 150 }, A, GAP)).toBe(true)
  })
  it('下邻：带 GAP、左对齐同一列 → true', () => {
    expect(isCardSnappedAdjacent({ x: 0, y: 262, width: 200, height: 150 }, A, GAP)).toBe(true)
  })
  it('上邻：带 GAP、左对齐同一列 → true', () => {
    expect(isCardSnappedAdjacent({ x: 0, y: -62, width: 200, height: 150 }, A, GAP)).toBe(true)
  })
  it('下邻：横向只部分重叠（错位半格）→ true', () => {
    expect(isCardSnappedAdjacent({ x: 100, y: 262, width: 200, height: 150 }, A, GAP)).toBe(true)
  })
  it('直接压在成员上（左上对齐、重叠）→ true', () => {
    expect(isCardSnappedAdjacent({ x: 0, y: 100, width: 200, height: 150 }, A, GAP)).toBe(true)
  })

  // —— bug 几何：单轴对齐而另一轴远离，必须 false（修复点） ——
  it('左边缘对齐但 y 相距很远（不同分区）→ false', () => {
    expect(isCardSnappedAdjacent({ x: 0, y: 3000, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
  it('右边缘对齐但 y 相距很远 → false', () => {
    expect(isCardSnappedAdjacent({ x: 0, y: -3000, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
  it('顶边对齐但 x 相距很远（不同分区）→ false', () => {
    expect(isCardSnappedAdjacent({ x: 3000, y: 100, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
  it('底边对齐但 x 相距很远 → false', () => {
    expect(isCardSnappedAdjacent({ x: -3000, y: 100, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
  it('GAP 列对齐但 y 远离（同列不同分区）→ false', () => {
    expect(isCardSnappedAdjacent({ x: 212, y: 3000, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
  it('完全不挨着 → false', () => {
    expect(isCardSnappedAdjacent({ x: 3000, y: 3000, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
  it('仅对角角接触（右下各隔一个 GAP，无边重叠）→ false（更合理）', () => {
    expect(isCardSnappedAdjacent({ x: 212, y: 262, width: 200, height: 150 }, A, GAP)).toBe(false)
  })
})

describe('finalizeCardMove（分区贴靠的集成行为）', () => {
  const mkCard = (id: string, x: number, y: number, w = 200, h = 150): Card =>
    ({ id, title: '', content: '', x, y, width: w, height: h })
  const mkSection = (id: string, x: number, y: number, w: number, h: number, cardIds: string[]): Section =>
    ({ id, name: id, x, y, width: w, height: h, color: '#fff', cardIds })

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  const setup = (cards: Card[], sections: Section[]) => {
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{ id: 'cv', name: 'cv', cards, sections }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null,
    })
  }

  it('远处分区不因单轴对齐被拉伸/吸附（bug 复现 → 已修）', () => {
    // cX 属于 A 且完全在 A 内；B 远在右侧，其成员 c2 与 cX 顶边对齐(y 同) 但 x 相距很远
    const cX = mkCard('cX', 50, 100)   // 在 A 内
    const c2 = mkCard('c2', 2000, 100) // B 成员，与 cX 顶边对齐
    const A = mkSection('A', 0, 0, 500, 500, ['cX'])
    const B = mkSection('B', 1990, 50, 300, 300, ['c2'])
    setup([cX, c2], [A, B])

    useStore.getState().finalizeCardMove('cX')

    const cv = useStore.getState().canvases[0]
    const a = cv.sections!.find((s) => s.id === 'A')!
    const b = cv.sections!.find((s) => s.id === 'B')!
    // B 几何完全不变、不吸纳 cX
    expect({ x: b.x, y: b.y, width: b.width, height: b.height }).toEqual({ x: 1990, y: 50, width: 300, height: 300 })
    expect(b.cardIds).toEqual(['c2'])
    // cX 仍属于 A
    expect(a.cardIds).toContain('cX')
  })

  it('近邻分区仍正常吸附扩展（防回归）', () => {
    // cX 不属于任何分区，紧贴 B 成员 c2 右侧(同一行、带 GAP)
    const c2 = mkCard('c2', 2000, 100)
    const cX = mkCard('cX', 2212, 100) // c2 右侧 GAP 紧邻
    const B = mkSection('B', 1990, 50, 300, 300, ['c2'])
    setup([cX, c2], [B])

    useStore.getState().finalizeCardMove('cX')

    const b = useStore.getState().canvases[0].sections!.find((s) => s.id === 'B')!
    expect(b.cardIds).toContain('cX')                  // 吸纳
    expect(b.x + b.width).toBeGreaterThanOrEqual(2412) // 扩展到包住 cX 右边(2212+200)
  })
})

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

})

describe('删除卡片清理悬空引用（#3）', () => {
  const mkCard = (id: string): Card => ({ id, title: '', content: '', x: 0, y: 0, width: 200, height: 150 })

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  const setup = () => {
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{
        id: 'cv', name: 'cv',
        cards: [mkCard('c1'), mkCard('c2'), mkCard('c3')],
        connections: [
          { id: 'cn1', fromCardId: 'c1', toCardId: 'c2' },
          { id: 'cn2', fromCardId: 'c2', toCardId: 'c3' },
        ],
        sections: [{ id: 's1', name: 's', x: 0, y: 0, width: 400, height: 400, color: '#fff', cardIds: ['c1', 'c2'] }],
      }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null,
    })
  }

  it('deleteUnits 删卡片后，清理指向它的连接 + 分区成员引用', () => {
    setup()
    useStore.getState().deleteUnits({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    const cv = useStore.getState().canvases[0]
    expect(cv.cards.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect((cv.connections ?? []).map((c) => c.id)).toEqual(['cn2'])           // cn1(c1↔c2) 被清
    expect(cv.sections![0].cardIds).toEqual(['c2'])                            // 分区成员去掉 c1
  })

  it('deleteCard 单删后，同样清理连接 + 分区成员引用', () => {
    setup()
    useStore.getState().deleteCard('c2')
    const cv = useStore.getState().canvases[0]
    expect(cv.cards.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect((cv.connections ?? []).map((c) => c.id)).toEqual([])               // cn1、cn2 都引用 c2 → 全清
    expect(cv.sections![0].cardIds).toEqual(['c1'])                           // 分区成员去掉 c2
  })
})

describe('方向键微移分区带动成员卡片（#4）', () => {
  const mkCard = (id: string, x: number, y: number): Card => ({ id, title: '', content: '', x, y, width: 200, height: 150 })

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  const setup = () => {
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{
        id: 'cv', name: 'cv',
        cards: [mkCard('c1', 10, 10), mkCard('c2', 20, 20), mkCard('c3', 500, 500)],
        sections: [{ id: 's1', name: 's', x: 0, y: 0, width: 400, height: 400, color: '#fff', cardIds: ['c1', 'c2'] }],
      }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null,
    })
  }

  it('微移选中分区时，成员卡片一起移动，非成员不动', () => {
    setup()
    useStore.getState().nudgeUnits({ cardIds: [], labelIds: [], sectionIds: ['s1'], textIds: [] }, 5, 7)
    const cv = useStore.getState().canvases[0]
    const get = (id: string) => cv.cards.find((c) => c.id === id)!
    expect({ x: cv.sections![0].x, y: cv.sections![0].y }).toEqual({ x: 5, y: 7 })  // 分区移动
    expect({ x: get('c1').x, y: get('c1').y }).toEqual({ x: 15, y: 17 })            // 成员 c1 跟随
    expect({ x: get('c2').x, y: get('c2').y }).toEqual({ x: 25, y: 27 })            // 成员 c2 跟随
    expect({ x: get('c3').x, y: get('c3').y }).toEqual({ x: 500, y: 500 })          // 非成员不动
  })

  it('成员卡片同时被直接选中时只移动一次（去重）', () => {
    setup()
    useStore.getState().nudgeUnits({ cardIds: ['c1'], labelIds: [], sectionIds: ['s1'], textIds: [] }, 5, 7)
    const c1 = useStore.getState().canvases[0].cards.find((c) => c.id === 'c1')!
    expect({ x: c1.x, y: c1.y }).toEqual({ x: 15, y: 17 })  // 只 +5,+7，不是 +10,+14
  })
})

describe('undo / redo（store 集成）', () => {
  const mkCard = (id: string, title: string) =>
    ({ id, title, content: '', x: 0, y: 0, width: 300, height: 150 })

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
    historyStore.clear()
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{ id: 'cv', name: 'cv', cards: [mkCard('c1', 'A')] }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null, suppressHistory: false,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('undo 恢复到记录时的内容，redo 再前进', () => {
    const cv0 = useStore.getState().canvases[0]
    historyStore.record('cv', snapshotCanvas(cv0))          // 记录 title=A
    useStore.getState().updateCard('c1', { title: 'B' })     // 改成 B
    expect(useStore.getState().canvases[0].cards[0].title).toBe('B')

    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].title).toBe('A')

    useStore.getState().redo()
    expect(useStore.getState().canvases[0].cards[0].title).toBe('B')
  })

  it('undo 无历史时不动作', () => {
    useStore.getState().undo()
    expect(useStore.getState().canvases[0].cards[0].title).toBe('A')
  })
})

describe('copy / paste（store 集成）', () => {
  const mkCard = (id: string, x: number) =>
    ({ id, title: id, content: '', x, y: 0, width: 300, height: 150 })

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
    historyStore.clear()
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{ id: 'cv', name: 'cv', cards: [mkCard('c1', 100)] }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null, suppressHistory: false,
      clipboard: null, pasteCount: 0,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('未复制时粘贴返回 null', () => {
    expect(useStore.getState().pasteClipboard()).toBeNull()
  })

  it('复制后粘贴生成偏移副本并返回新 id', () => {
    useStore.getState().copySelection({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    const ids = useStore.getState().pasteClipboard()
    expect(ids).not.toBeNull()
    const cv = useStore.getState().canvases[0]
    expect(cv.cards.length).toBe(2)
    const pasted = cv.cards.find((c) => c.id === ids!.cardIds[0])!
    expect(pasted.x).toBe(124) // 100 + 24
  })

  it('连续粘贴偏移递增', () => {
    useStore.getState().copySelection({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    useStore.getState().pasteClipboard()
    useStore.getState().pasteClipboard()
    const xs = useStore.getState().canvases[0].cards.map((c) => c.x).sort((a, b) => a - b)
    expect(xs).toEqual([100, 124, 148])
  })

  it('pasteClipboardAt 把粘贴组左上角对齐给定坐标', () => {
    useStore.getState().copySelection({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    const ids = useStore.getState().pasteClipboardAt(500, 300)
    expect(ids).not.toBeNull()
    const cv = useStore.getState().canvases[0]
    const pasted = cv.cards.find((c) => c.id === ids!.cardIds[0])!
    expect({ x: pasted.x, y: pasted.y }).toEqual({ x: 500, y: 300 }) // 原 c1 在 (100,0)=左上角 → 落到 (500,300)
  })

  it('pasteClipboardAt 不改 pasteCount（不递增）', () => {
    useStore.getState().copySelection({ cardIds: ['c1'], labelIds: [], sectionIds: [], textIds: [] })
    useStore.getState().pasteClipboardAt(500, 300)
    expect(useStore.getState().pasteCount).toBe(0)
  })

  it('未复制时 pasteClipboardAt 返回 null', () => {
    expect(useStore.getState().pasteClipboardAt(10, 10)).toBeNull()
  })
})

describe('arrangeUnits 按实测高度排布（修复 undefined 高度重叠）', () => {
  const mkCard = (id: string, x: number, y: number, h?: number): Card =>
    ({ id, title: '', content: '', x, y, width: 300, ...(h != null ? { height: h } : {}) })

  const EMPTY = { labelIds: [], sectionIds: [], textIds: [] }

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true) } }
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  const setup = (cards: Card[]) => {
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{ id: 'cv', name: 'cv', cards }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null,
    })
  }

  it('传入实测高度 → 同列按真高+GAP 堆叠，不重叠', () => {
    // 三张同列卡片，height 均 undefined（CLI 批量写入场景）
    setup([mkCard('c1', 100, 50), mkCard('c2', 100, 300), mkCard('c3', 100, 700)])
    useStore.getState().arrangeUnits(
      { cardIds: ['c1', 'c2', 'c3'], ...EMPTY },
      { c1: 100, c2: 400, c3: 150 },
    )
    const cv = useStore.getState().canvases[0]
    const g = (id: string) => cv.cards.find((c) => c.id === id)!
    // originY=50, GAP=20 → c1=50, c2=50+100+20=170, c3=170+400+20=590
    expect(g('c1').y).toBe(50)
    expect(g('c2').y).toBe(170)
    expect(g('c3').y).toBe(590)
    // 同列 x 对齐
    expect(g('c1').x).toBe(g('c2').x)
    expect(g('c2').x).toBe(g('c3').x)
  })

  it('未传实测高度 → 退回 card.height ?? 200（向后兼容）', () => {
    setup([mkCard('c1', 100, 50, 120), mkCard('c2', 100, 300, 300)])
    useStore.getState().arrangeUnits({ cardIds: ['c1', 'c2'], ...EMPTY })
    const cv = useStore.getState().canvases[0]
    const g = (id: string) => cv.cards.find((c) => c.id === id)!
    // c1 高 120 → c2 = 50+120+20 = 190
    expect(g('c2').y).toBe(190)
  })

  it('实测高度只覆盖给定卡片，其余用存储高度', () => {
    setup([mkCard('c1', 100, 50), mkCard('c2', 100, 300, 250)])
    useStore.getState().arrangeUnits(
      { cardIds: ['c1', 'c2'], ...EMPTY },
      { c1: 90 }, // 只给 c1 实测高
    )
    const cv = useStore.getState().canvases[0]
    // c1 用实测 90 → c2 = 50+90+20 = 160
    expect(cv.cards.find((c) => c.id === 'c2')!.y).toBe(160)
  })
})

describe('updateCard 无变化时短路，不触发持久化/同步（层2）', () => {
  const mkCard = (id: string): Card =>
    ({ id, title: 'A', content: 'X', x: 10, y: 20, width: 300, height: 150 })

  let writeData: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    writeData = vi.fn(() => Promise.resolve(true))
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData } }
    useStore.setState({
      activeCanvasId: 'cv',
      canvases: [{ id: 'cv', name: 'cv', cards: [mkCard('c1')] }],
      settings: { theme: 'light' } as AppSettings,
      syncDecision: null,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('patch 与现值完全相同（title/content）→ 不写盘', () => {
    useStore.getState().updateCard('c1', { title: 'A', content: 'X' })
    vi.advanceTimersByTime(600)
    expect(writeData).not.toHaveBeenCalled()
  })

  it('patch 与现值相同（height）→ 不写盘', () => {
    useStore.getState().updateCard('c1', { height: 150 })
    vi.advanceTimersByTime(600)
    expect(writeData).not.toHaveBeenCalled()
  })

  it('无变化的 patch 不改变卡片对象引用（不触发无谓渲染）', () => {
    const before = useStore.getState().canvases[0].cards[0]
    useStore.getState().updateCard('c1', { title: 'A' })
    expect(useStore.getState().canvases[0].cards[0]).toBe(before)
  })

  it('patch 确有变化 → 仍写盘一次（防回归）', () => {
    useStore.getState().updateCard('c1', { title: 'B' })
    vi.advanceTimersByTime(600)
    expect(writeData).toHaveBeenCalledTimes(1)
  })

  it('部分字段变化（title 未变、height 变了）→ 写盘', () => {
    useStore.getState().updateCard('c1', { title: 'A', height: 300 })
    vi.advanceTimersByTime(600)
    expect(writeData).toHaveBeenCalledTimes(1)
  })

  it('目标卡片不存在 → 不写盘、不报错', () => {
    useStore.getState().updateCard('不存在', { title: 'Z' })
    vi.advanceTimersByTime(600)
    expect(writeData).not.toHaveBeenCalled()
  })
})

describe('分享 shareId', () => {
  const mkCanvas = () => ({ id: 'cv', name: 'cv', cards: [] })
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { writeData: () => Promise.resolve(true), writeSettings: () => Promise.resolve(true) } }
    useStore.setState({ activeCanvasId: 'cv', canvases: [mkCanvas()], settings: { theme: 'light' } as AppSettings, syncDecision: null })
  })
  afterEach(() => { vi.useRealTimers(); delete (globalThis as unknown as { window?: unknown }).window })

  it('ensureShareId 生成并幂等', () => {
    const id1 = useStore.getState().ensureShareId('cv')
    expect(id1).toBeTruthy()
    expect(useStore.getState().canvases[0].shareId).toBe(id1)
    const id2 = useStore.getState().ensureShareId('cv')
    expect(id2).toBe(id1) // 幂等
  })

  it('unshareCanvas 清除 shareId', () => {
    useStore.getState().ensureShareId('cv')
    useStore.getState().unshareCanvas('cv')
    expect(useStore.getState().canvases[0].shareId).toBeUndefined()
  })

  it('setShareDomain 写入 settings', () => {
    useStore.getState().setShareDomain('https://v.app/')
    expect(useStore.getState().settings.shareDomain).toBe('https://v.app/')
    useStore.getState().setShareDomain('  ')
    expect(useStore.getState().settings.shareDomain).toBeUndefined()
  })
})
