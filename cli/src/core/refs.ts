import type { AppData, Canvas, Card } from '../types'
import { findById } from './_helpers'
export { RefError } from './_helpers'

export function resolveCanvas(data: AppData, ref: string): Canvas {
  return findById(data.canvases, ref, '画布', (c) => c.name === ref)
}

export function resolveCard(canvas: Canvas, ref: string): Card {
  return findById(canvas.cards, ref, '卡片')
}
