import { randomUUID } from 'node:crypto'
import type { AppData, CanvasLabel } from '../types'
import { resolveCanvas } from './refs'
import { mapCanvas, findById } from './_helpers'
import { nextSlot } from './layout'
import { LABEL_DEFAULT_WIDTH, LABEL_DEFAULT_LEVEL, LABEL_DEFAULT_TEXT } from '../constants'

export interface LabelInput { text?: string; level?: 0 | 1 | 2 | 3 | 4; x?: number; y?: number; width?: number }

export function listLabels(data: AppData, canvasRef: string): CanvasLabel[] { return resolveCanvas(data, canvasRef).labels ?? [] }

export function addLabel(data: AppData, canvasRef: string, input: LabelInput): { data: AppData; label: CanvasLabel } {
  const canvas = resolveCanvas(data, canvasRef)
  const width = input.width ?? LABEL_DEFAULT_WIDTH
  const pos = (input.x != null && input.y != null) ? { x: input.x, y: input.y } : nextSlot(canvas, width, 48)
  const label: CanvasLabel = { id: randomUUID(), text: input.text ?? LABEL_DEFAULT_TEXT, level: input.level ?? LABEL_DEFAULT_LEVEL, x: input.x ?? pos.x, y: input.y ?? pos.y, width }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, labels: [...(c.labels ?? []), label] })), label }
}

export function setLabel(data: AppData, canvasRef: string, ref: string, patch: LabelInput): { data: AppData; label: CanvasLabel } {
  const canvas = resolveCanvas(data, canvasRef)
  const target = findById(canvas.labels, ref, '标签')
  const label = { ...target, ...patch }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, labels: (c.labels ?? []).map((l) => l.id === target.id ? label : l) })), label }
}

export function removeLabel(data: AppData, canvasRef: string, ref: string): { data: AppData; removed: CanvasLabel } {
  const canvas = resolveCanvas(data, canvasRef)
  const removed = findById(canvas.labels, ref, '标签')
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, labels: (c.labels ?? []).filter((l) => l.id !== removed.id) })), removed }
}
