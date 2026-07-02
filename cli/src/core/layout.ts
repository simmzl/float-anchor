import type { Canvas } from '../types'

const MARGIN = 40
const GAP = 40

interface Box { x: number; y: number; width: number; height: number }

function boxes(canvas: Canvas): Box[] {
  const out: Box[] = []
  const push = (e: any, dw: number, dh: number) => out.push({ x: e.x, y: e.y, width: e.width ?? dw, height: e.height ?? dh })
  canvas.cards.forEach((c) => push(c, 373, 200))
  canvas.texts?.forEach((t) => push(t, 300, 120))
  canvas.labels?.forEach((l) => push(l, 300, 48))
  canvas.sections?.forEach((s) => push(s, 600, 400))
  return out
}

export function nextSlot(canvas: Canvas, width: number, height: number): { x: number; y: number } {
  const bs = boxes(canvas)
  if (bs.length === 0) return { x: MARGIN, y: MARGIN }
  const maxRight = Math.max(...bs.map((b) => b.x + b.width))
  const topY = Math.min(...bs.map((b) => b.y))
  return { x: maxRight + GAP, y: topY }
}
