import { v4 as uuid } from 'uuid'
import type { Canvas, Card, TextBox, CanvasLabel, Section, Connection } from './types'

export interface ClipboardPayload {
  cards: Card[]
  texts: TextBox[]
  labels: CanvasLabel[]
  sections: Section[]
  connections: Connection[]
}

export interface SelectionIds {
  cardIds: string[]
  labelIds: string[]
  sectionIds: string[]
  textIds: string[]
}

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))

const stripSource = <T extends { sourceId?: string }>(o: T): T => {
  const c = { ...o }
  delete c.sourceId
  return c
}

export function buildClipboard(canvas: Canvas, sel: SelectionIds): ClipboardPayload | null {
  const cardIds = new Set(sel.cardIds)
  const sections = (canvas.sections ?? []).filter((s) => sel.sectionIds.includes(s.id))
  for (const s of sections) for (const cid of (s.cardIds ?? [])) cardIds.add(cid)

  const cards = canvas.cards.filter((c) => cardIds.has(c.id))
  const texts = (canvas.texts ?? []).filter((t) => sel.textIds.includes(t.id))
  const labels = (canvas.labels ?? []).filter((l) => sel.labelIds.includes(l.id))
  const connections = (canvas.connections ?? []).filter(
    (cn) => cardIds.has(cn.fromCardId) && cardIds.has(cn.toCardId),
  )

  if (cards.length + texts.length + labels.length + sections.length === 0) return null
  return clone({ cards, texts, labels, sections, connections })
}

export function instantiatePaste(
  payload: ClipboardPayload,
  dx: number,
  dy: number,
): { cards: Card[]; texts: TextBox[]; labels: CanvasLabel[]; sections: Section[]; connections: Connection[]; ids: SelectionIds } {
  const idMap = new Map<string, string>()
  const mapId = (old: string): string => {
    const n = uuid()
    idMap.set(old, n)
    return n
  }

  const cards: Card[] = payload.cards.map((c) => ({ ...stripSource(c), id: mapId(c.id), x: c.x + dx, y: c.y + dy }))
  const texts: TextBox[] = payload.texts.map((t) => ({ ...stripSource(t), id: mapId(t.id), x: t.x + dx, y: t.y + dy }))
  const labels: CanvasLabel[] = payload.labels.map((l) => ({ ...stripSource(l), id: mapId(l.id), x: l.x + dx, y: l.y + dy }))
  const sections: Section[] = payload.sections.map((s) => ({
    ...stripSource(s),
    id: mapId(s.id),
    x: s.x + dx,
    y: s.y + dy,
    cardIds: (s.cardIds ?? []).map((cid) => idMap.get(cid)).filter((v): v is string => !!v),
  }))
  const connections: Connection[] = payload.connections
    .map((cn) => {
      const from = idMap.get(cn.fromCardId)
      const to = idMap.get(cn.toCardId)
      return from && to ? { id: uuid(), fromCardId: from, toCardId: to } : null
    })
    .filter((v): v is Connection => !!v)

  return {
    cards, texts, labels, sections, connections,
    ids: {
      cardIds: cards.map((c) => c.id),
      labelIds: labels.map((l) => l.id),
      sectionIds: sections.map((s) => s.id),
      textIds: texts.map((t) => t.id),
    },
  }
}
