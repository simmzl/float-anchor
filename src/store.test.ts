import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getEffectiveProvider, isCardSnappedAdjacent, useStore } from './store'
import type { AppSettings, Card, Section } from './types'

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
