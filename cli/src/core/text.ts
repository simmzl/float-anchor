import { randomUUID } from 'node:crypto'
import type { AppData, TextBox } from '../types'
import { resolveCanvas } from './refs'
import { mapCanvas, findById } from './_helpers'
import { nextSlot } from './layout'
import { TEXT_DEFAULT_WIDTH } from '../constants'

export interface TextInput { text?: string; x?: number; y?: number; width?: number }

export function listTexts(data: AppData, canvasRef: string): TextBox[] { return resolveCanvas(data, canvasRef).texts ?? [] }

export function addText(data: AppData, canvasRef: string, input: TextInput): { data: AppData; text: TextBox } {
  const canvas = resolveCanvas(data, canvasRef)
  const width = input.width ?? TEXT_DEFAULT_WIDTH
  const pos = (input.x != null && input.y != null) ? { x: input.x, y: input.y } : nextSlot(canvas, width, 120)
  const text: TextBox = { id: randomUUID(), text: input.text ?? '', x: input.x ?? pos.x, y: input.y ?? pos.y, width }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, texts: [...(c.texts ?? []), text] })), text }
}

export function setText(data: AppData, canvasRef: string, ref: string, patch: TextInput): { data: AppData; text: TextBox } {
  const canvas = resolveCanvas(data, canvasRef)
  const target = findById(canvas.texts, ref, '文本框')
  const text = { ...target, ...patch }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, texts: (c.texts ?? []).map((t) => t.id === target.id ? text : t) })), text }
}

export function removeText(data: AppData, canvasRef: string, ref: string): { data: AppData; removed: TextBox } {
  const canvas = resolveCanvas(data, canvasRef)
  const removed = findById(canvas.texts, ref, '文本框')
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, texts: (c.texts ?? []).filter((t) => t.id !== removed.id) })), removed }
}
