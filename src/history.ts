import type { Canvas, Card, TextBox, CanvasLabel, Section, Connection } from './types'

export interface CanvasSnapshot {
  cards: Card[]
  texts: TextBox[]
  labels: CanvasLabel[]
  sections: Section[]
  connections: Connection[]
}

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))

export function snapshotCanvas(canvas: Canvas): CanvasSnapshot {
  return {
    cards: clone(canvas.cards ?? []),
    texts: clone(canvas.texts ?? []),
    labels: clone(canvas.labels ?? []),
    sections: clone(canvas.sections ?? []),
    connections: clone(canvas.connections ?? []),
  }
}

export function contentFingerprint(canvas: Canvas): string {
  return JSON.stringify({
    cards: canvas.cards ?? [],
    texts: canvas.texts ?? [],
    labels: canvas.labels ?? [],
    sections: canvas.sections ?? [],
    connections: canvas.connections ?? [],
  })
}

export function applySnapshot(canvas: Canvas, snap: CanvasSnapshot): Canvas {
  return {
    ...canvas,
    cards: clone(snap.cards),
    texts: clone(snap.texts),
    labels: clone(snap.labels),
    sections: clone(snap.sections),
    connections: clone(snap.connections),
  }
}
