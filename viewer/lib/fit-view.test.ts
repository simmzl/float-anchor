import { describe, it, expect } from 'vitest'
import {
  getContentBounds, computeFitView, zoomAroundPoint, clampScale,
  MIN_SCALE, MAX_SCALE, FIT_MAX_SCALE,
} from './fit-view'
import type { Canvas } from './types'

const mkCanvas = (over: Partial<Canvas> = {}): Canvas =>
  ({ id: 'c1', name: 'C', cards: [], ...over })

const card = (over: any = {}) =>
  ({ id: 'k', title: '', content: '', x: 0, y: 0, width: 300, ...over })

describe('getContentBounds — 包围盒覆盖所有元素类型', () => {
  it('空画布 → null', () => {
    expect(getContentBounds(mkCanvas())).toBeNull()
  })

  it('卡片：无 height 时按 200 兜底', () => {
    const b = getContentBounds(mkCanvas({ cards: [card({ x: 10, y: 20, width: 300 })] }))
    expect(b).toEqual({ minX: 10, minY: 20, maxX: 310, maxY: 220 })
  })

  it('卡片：有 height 时用真实高度', () => {
    const b = getContentBounds(mkCanvas({ cards: [card({ x: 0, y: 0, width: 100, height: 50 })] }))
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 })
  })

  it('分区纳入包围盒（此前只算卡片的漏算点）', () => {
    const b = getContentBounds(mkCanvas({
      cards: [card({ x: 0, y: 0, width: 100, height: 100 })],
      sections: [{ id: 's', name: 'S', x: -500, y: -300, width: 200, height: 100, color: '#fff' }],
    }))
    expect(b!.minX).toBe(-500)
    expect(b!.minY).toBe(-300)
  })

  it('文本框纳入包围盒，无 height 时按行数估算（单行）', () => {
    const b = getContentBounds(mkCanvas({
      texts: [{ id: 't', text: '单行', x: 1000, y: 2000, width: 200 }],
    }))
    expect(b!.minX).toBe(1000)
    expect(b!.maxX).toBe(1200)
    expect(b!.maxY).toBeCloseTo(2000 + 29, 5) // 1 行 × 21 + 上下 padding 8
  })

  it('文本框多行：按换行数累加（实测两行渲染高 50）', () => {
    const b = getContentBounds(mkCanvas({
      texts: [{ id: 't', text: '第一行\n第二行', x: 0, y: 0, width: 200 }],
    }))
    expect(b!.maxY).toBeCloseTo(50, 5)
  })

  it('文本框有显式 height 时以其为准', () => {
    const b = getContentBounds(mkCanvas({
      texts: [{ id: 't', text: 'a\nb\nc\nd', x: 0, y: 0, width: 200, height: 12 }],
    }))
    expect(b!.maxY).toBe(12)
  })

  it('标题纳入包围盒，高度按层级字号估算（大于 0）', () => {
    const b = getContentBounds(mkCanvas({
      labels: [{ id: 'l', text: 'T', level: 1, x: 0, y: 0, width: 400 }],
    }))
    expect(b!.maxX).toBe(400)
    expect(b!.maxY).toBeGreaterThan(0)
  })

  it('一级标题比零级标题更高（字号越大估高越大）', () => {
    const big = getContentBounds(mkCanvas({ labels: [{ id: 'l', text: 'T', level: 1, x: 0, y: 0, width: 100 }] }))
    const small = getContentBounds(mkCanvas({ labels: [{ id: 'l', text: 'T', level: 0, x: 0, y: 0, width: 100 }] }))
    expect(big!.maxY).toBeGreaterThan(small!.maxY)
  })

  it('多类型混合 → 取全体极值', () => {
    const b = getContentBounds(mkCanvas({
      cards: [card({ x: 0, y: 0, width: 100, height: 100 })],
      sections: [{ id: 's', name: 'S', x: 200, y: 200, width: 100, height: 100, color: '#fff' }],
      texts: [{ id: 't', text: 'x', x: -50, y: 500, width: 10, height: 10 }],
    }))
    expect(b).toEqual({ minX: -50, minY: 0, maxX: 300, maxY: 510 })
  })
})

describe('computeFitView — 打开即锚定中心且全部元素在视口内', () => {
  const vpW = 1000
  const vpH = 800

  it('空画布 → 原点 100%', () => {
    expect(computeFitView(mkCanvas(), vpW, vpH)).toEqual({ panX: 0, panY: 0, scale: 1 })
  })

  it('内容中心落在视口中心', () => {
    // 内容 x∈[100,500] y∈[0,400]，中心 (300, 200)
    const canvas = mkCanvas({ cards: [card({ x: 100, y: 0, width: 400, height: 400 })] })
    const v = computeFitView(canvas, vpW, vpH)
    expect(v.panX + 300 * v.scale).toBeCloseTo(vpW / 2, 5)
    expect(v.panY + 200 * v.scale).toBeCloseTo(vpH / 2, 5)
  })

  it('大内容缩小后完整落在视口内（含留白）', () => {
    const canvas = mkCanvas({ cards: [card({ x: 0, y: 0, width: 4000, height: 3000 })] })
    const v = computeFitView(canvas, vpW, vpH)
    const left = v.panX + 0 * v.scale
    const top = v.panY + 0 * v.scale
    const right = v.panX + 4000 * v.scale
    const bottom = v.panY + 3000 * v.scale
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(vpW)
    expect(bottom).toBeLessThanOrEqual(vpH)
  })

  it('小内容不会被放大到超过 FIT_MAX_SCALE', () => {
    const canvas = mkCanvas({ cards: [card({ x: 0, y: 0, width: 10, height: 10 })] })
    expect(computeFitView(canvas, vpW, vpH).scale).toBe(FIT_MAX_SCALE)
  })

  it('超大内容缩放不低于 MIN_SCALE', () => {
    const canvas = mkCanvas({ cards: [card({ x: 0, y: 0, width: 900000, height: 900000 })] })
    expect(computeFitView(canvas, vpW, vpH).scale).toBe(MIN_SCALE)
  })

  it('视口尺寸为 0（未挂载）→ 回退原点 100%，不产生 NaN', () => {
    const canvas = mkCanvas({ cards: [card({ x: 0, y: 0, width: 400, height: 400 })] })
    const v = computeFitView(canvas, 0, 0)
    expect(v).toEqual({ panX: 0, panY: 0, scale: 1 })
  })

  it('忽略快照内嵌 viewport，始终按内容自适应', () => {
    const canvas = mkCanvas({
      cards: [card({ x: 100, y: 0, width: 400, height: 400 })],
      viewport: { panX: 9999, panY: 9999, scale: 3 },
    })
    const v = computeFitView(canvas, vpW, vpH)
    expect(v.panX).not.toBe(9999)
    expect(v.scale).not.toBe(3)
  })
})

describe('clampScale', () => {
  it('低于下限 → MIN_SCALE', () => expect(clampScale(0.001)).toBe(MIN_SCALE))
  it('高于上限 → MAX_SCALE', () => expect(clampScale(99)).toBe(MAX_SCALE))
  it('区间内 → 原值', () => expect(clampScale(1.5)).toBe(1.5))
})

describe('zoomAroundPoint — 以锚点为中心缩放', () => {
  it('锚点下的画布坐标缩放前后不变（视口中心按钮缩放）', () => {
    const view = { panX: 120, panY: -60, scale: 1 }
    const [ax, ay] = [500, 400]
    // 锚点对应的画布坐标
    const beforeX = (ax - view.panX) / view.scale
    const beforeY = (ay - view.panY) / view.scale

    const next = zoomAroundPoint(view, view.scale * 1.25, ax, ay)
    const afterX = (ax - next.panX) / next.scale
    const afterY = (ay - next.panY) / next.scale

    expect(Math.abs(afterX - beforeX)).toBeLessThanOrEqual(1) // pan 取整带来的 ≤1px 误差
    expect(Math.abs(afterY - beforeY)).toBeLessThanOrEqual(1)
  })

  it('放大：scale 按倍率增长', () => {
    expect(zoomAroundPoint({ panX: 0, panY: 0, scale: 1 }, 1.25, 0, 0).scale).toBe(1.25)
  })

  it('缩小：scale 按倍率减小', () => {
    expect(zoomAroundPoint({ panX: 0, panY: 0, scale: 1 }, 1 / 1.25, 0, 0).scale).toBeCloseTo(0.8, 10)
  })

  it('已达上限再放大 → 停在 MAX_SCALE 且视图不跳变', () => {
    const view = { panX: 10, panY: 20, scale: MAX_SCALE }
    const next = zoomAroundPoint(view, MAX_SCALE * 1.25, 100, 100)
    expect(next.scale).toBe(MAX_SCALE)
    expect(next.panX).toBe(10)
    expect(next.panY).toBe(20)
  })

  it('已达下限再缩小 → 停在 MIN_SCALE', () => {
    const next = zoomAroundPoint({ panX: 0, panY: 0, scale: MIN_SCALE }, MIN_SCALE / 1.25, 0, 0)
    expect(next.scale).toBe(MIN_SCALE)
  })
})
