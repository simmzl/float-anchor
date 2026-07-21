import type { Canvas } from './types'

export const MIN_SCALE = 0.15
export const MAX_SCALE = 3
// 自适应时的缩放上限：内容很少时不要放得过大
export const FIT_MAX_SCALE = 1.2
// 自适应后内容占视口的比例，留出四周呼吸空间
export const FIT_PADDING_RATIO = 0.85

export const LABEL_LEVEL_SIZES: Record<number, { fontSize: number; fontWeight: number }> = {
  0: { fontSize: 14, fontWeight: 400 },
  1: { fontSize: 28, fontWeight: 700 },
  2: { fontSize: 22, fontWeight: 650 },
  3: { fontSize: 18, fontWeight: 600 },
  4: { fontSize: 15, fontWeight: 600 },
}

const CARD_FALLBACK_HEIGHT = 200
// .canvas-label 为单行：字号 × 行高 1.3 + 上下 padding 6px×2 + 边框 1px×2
const LABEL_LINE_HEIGHT = 1.3
const LABEL_VERTICAL_CHROME = 14
// .text-content：字号 14 × 行高 1.5 = 21，加 .canvas-text 上下 padding 4px×2
const TEXT_LINE_HEIGHT = 21
const TEXT_VERTICAL_CHROME = 8

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface View { panX: number; panY: number; scale: number }

export function estimateLabelHeight(level: number): number {
  const size = LABEL_LEVEL_SIZES[level] ?? LABEL_LEVEL_SIZES[1]
  return size.fontSize * LABEL_LINE_HEIGHT + LABEL_VERTICAL_CHROME
}

/**
 * 未记录高度的文本框按显式换行数估算。
 * 超宽自动折行的部分算不进来，此时会略微低估——仅影响自适应留白，不影响可见性。
 */
export function estimateTextHeight(text: string): number {
  const lines = Math.max((text ?? '').split('\n').length, 1)
  return lines * TEXT_LINE_HEIGHT + TEXT_VERTICAL_CHROME
}

/** 画布上全部可见元素的包围盒；无元素返回 null。连线依附于卡片，不单独计入。 */
export function getContentBounds(canvas: Canvas): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let has = false

  const add = (x: number, y: number, w: number, h: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    has = true
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + w > maxX) maxX = x + w
    if (y + h > maxY) maxY = y + h
  }

  for (const c of canvas.cards ?? []) add(c.x, c.y, c.width, c.height ?? CARD_FALLBACK_HEIGHT)
  for (const s of canvas.sections ?? []) add(s.x, s.y, s.width, s.height)
  for (const t of canvas.texts ?? []) add(t.x, t.y, t.width, t.height ?? estimateTextHeight(t.text))
  for (const l of canvas.labels ?? []) add(l.x, l.y, l.width, estimateLabelHeight(l.level))

  return has ? { minX, minY, maxX, maxY } : null
}

export function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)
}

/**
 * 自适应视图：让全部元素落在视口内并居中。
 * 快照里可能残留的 canvas.viewport 不参与计算——视口是设备本地状态，不跟随分享数据走。
 */
export function computeFitView(canvas: Canvas, viewportWidth: number, viewportHeight: number): View {
  const bounds = getContentBounds(canvas)
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) return { panX: 0, panY: 0, scale: 1 }

  const contentW = Math.max(bounds.maxX - bounds.minX, 1)
  const contentH = Math.max(bounds.maxY - bounds.minY, 1)
  const scaleX = (viewportWidth * FIT_PADDING_RATIO) / contentW
  const scaleY = (viewportHeight * FIT_PADDING_RATIO) / contentH
  const scale = Math.min(clampScale(Math.min(scaleX, scaleY)), FIT_MAX_SCALE)

  const centerX = bounds.minX + contentW / 2
  const centerY = bounds.minY + contentH / 2
  return {
    panX: viewportWidth / 2 - centerX * scale,
    panY: viewportHeight / 2 - centerY * scale,
    scale,
  }
}

/** 以视口内某点为锚缩放：该点下的画布坐标保持不动。滚轮缩放与按钮缩放共用。 */
export function zoomAroundPoint(view: View, nextScale: number, anchorX: number, anchorY: number): View {
  const scale = clampScale(nextScale)
  const ratio = scale / view.scale
  return {
    panX: Math.round(anchorX - (anchorX - view.panX) * ratio),
    panY: Math.round(anchorY - (anchorY - view.panY) * ratio),
    scale,
  }
}
