import { randomUUID } from 'node:crypto'
import type { AppData, Card } from '../types'
import { resolveCanvas, resolveCard } from './refs'
import { mapCanvas } from './_helpers'
import { nextSlot } from './layout'
import { CARD_DEFAULT_WIDTH, CARD_DEFAULT_TITLE } from '../constants'

export interface CardInput { title?: string; content?: string; x?: number; y?: number; width?: number; height?: number }

export function listCards(data: AppData, canvasRef: string): Card[] {
  return resolveCanvas(data, canvasRef).cards
}

export function addCard(data: AppData, canvasRef: string, input: CardInput): { data: AppData; card: Card } {
  const canvas = resolveCanvas(data, canvasRef)
  const width = input.width ?? CARD_DEFAULT_WIDTH
  const pos = (input.x != null && input.y != null) ? { x: input.x, y: input.y } : nextSlot(canvas, width, 200)
  const card: Card = {
    id: randomUUID(),
    title: input.title ?? CARD_DEFAULT_TITLE,
    content: input.content ?? '',
    x: input.x ?? pos.x,
    y: input.y ?? pos.y,
    width,
    ...(input.height != null ? { height: input.height } : {}),
  }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, cards: [...c.cards, card] })), card }
}

export function setCard(data: AppData, canvasRef: string, cardRef: string, patch: CardInput): { data: AppData; card: Card } {
  const canvas = resolveCanvas(data, canvasRef)
  const target = resolveCard(canvas, cardRef)
  const card = { ...target, ...patch }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, cards: c.cards.map((x) => x.id === target.id ? card : x) })), card }
}

export function moveCard(data: AppData, canvasRef: string, cardRef: string, x: number, y: number): { data: AppData; card: Card } {
  return setCard(data, canvasRef, cardRef, { x, y })
}

export function removeCard(data: AppData, canvasRef: string, cardRef: string): { data: AppData; removed: Card } {
  const canvas = resolveCanvas(data, canvasRef)
  const removed = resolveCard(canvas, cardRef)
  return {
    data: mapCanvas(data, canvas.id, (c) => ({
      ...c,
      cards: c.cards.filter((x) => x.id !== removed.id),
      connections: (c.connections ?? []).filter((cn) => cn.fromCardId !== removed.id && cn.toCardId !== removed.id),
      sections: (c.sections ?? []).map((s) => (s.cardIds ?? []).includes(removed.id)
        ? { ...s, cardIds: (s.cardIds ?? []).filter((id) => id !== removed.id) } : s),
    })),
    removed,
  }
}
