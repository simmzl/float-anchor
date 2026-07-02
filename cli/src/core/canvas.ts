import { randomUUID } from 'node:crypto'
import type { AppData, Canvas } from '../types'
import { resolveCanvas } from './refs'

export function listCanvases(data: AppData): Canvas[] { return data.canvases }

export function createCanvas(data: AppData, name: string): { data: AppData; canvas: Canvas } {
  const canvas: Canvas = { id: randomUUID(), name, cards: [] }
  return { data: { ...data, canvases: [...data.canvases, canvas] }, canvas }
}

export function renameCanvas(data: AppData, ref: string, newName: string): { data: AppData; canvas: Canvas } {
  const target = resolveCanvas(data, ref)
  const canvas = { ...target, name: newName }
  return { data: { ...data, canvases: data.canvases.map((c) => c.id === target.id ? canvas : c) }, canvas }
}

export function removeCanvas(data: AppData, ref: string): { data: AppData; removed: Canvas } {
  const removed = resolveCanvas(data, ref)
  const next = data.canvases.filter((c) => c.id !== removed.id)
  const activeCanvasId = data.activeCanvasId === removed.id
    ? (next.length > 0 ? next[0].id : null)
    : data.activeCanvasId
  return { data: { ...data, canvases: next, activeCanvasId }, removed }
}
