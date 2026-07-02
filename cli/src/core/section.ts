import { randomUUID } from 'node:crypto'
import type { AppData, Section } from '../types'
import { resolveCanvas } from './refs'
import { mapCanvas, findById } from './_helpers'
import { nextSlot } from './layout'
import { SECTION_DEFAULT_WIDTH, SECTION_DEFAULT_HEIGHT, SECTION_DEFAULT_NAME, SECTION_COLORS } from '../constants'

export interface SectionInput { name?: string; color?: string; x?: number; y?: number; width?: number; height?: number }

export function listSections(data: AppData, canvasRef: string): Section[] { return resolveCanvas(data, canvasRef).sections ?? [] }

export function addSection(data: AppData, canvasRef: string, input: SectionInput): { data: AppData; section: Section } {
  const canvas = resolveCanvas(data, canvasRef)
  const count = canvas.sections?.length ?? 0
  const width = input.width ?? SECTION_DEFAULT_WIDTH
  const height = input.height ?? SECTION_DEFAULT_HEIGHT
  const pos = (input.x != null && input.y != null) ? { x: input.x, y: input.y } : nextSlot(canvas, width, height)
  const section: Section = {
    id: randomUUID(),
    name: input.name ?? SECTION_DEFAULT_NAME,
    x: input.x ?? pos.x, y: input.y ?? pos.y, width, height,
    color: input.color ?? SECTION_COLORS[count % SECTION_COLORS.length],
    cardIds: [],
  }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, sections: [...(c.sections ?? []), section] })), section }
}

export function setSection(data: AppData, canvasRef: string, ref: string, patch: SectionInput): { data: AppData; section: Section } {
  const canvas = resolveCanvas(data, canvasRef)
  const target = findById(canvas.sections, ref, '分区')
  const section = { ...target, ...patch }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, sections: (c.sections ?? []).map((s) => s.id === target.id ? section : s) })), section }
}

export function removeSection(data: AppData, canvasRef: string, ref: string): { data: AppData; removed: Section } {
  const canvas = resolveCanvas(data, canvasRef)
  const removed = findById(canvas.sections, ref, '分区')
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, sections: (c.sections ?? []).filter((s) => s.id !== removed.id) })), removed }
}
