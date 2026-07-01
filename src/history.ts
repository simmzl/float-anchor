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

export const MAX_HISTORY = 50

interface Stacks { undo: CanvasSnapshot[]; redo: CanvasSnapshot[] }

class HistoryStore {
  private map = new Map<string, Stacks>()

  private stacks(id: string): Stacks {
    let s = this.map.get(id)
    if (!s) { s = { undo: [], redo: [] }; this.map.set(id, s) }
    return s
  }

  record(id: string, snap: CanvasSnapshot): void {
    const s = this.stacks(id)
    s.undo.push(snap)
    if (s.undo.length > MAX_HISTORY) s.undo.shift()
    s.redo = []
  }

  undo(id: string, current: CanvasSnapshot): CanvasSnapshot | null {
    const s = this.stacks(id)
    const prev = s.undo.pop()
    if (!prev) return null
    s.redo.push(current)
    if (s.redo.length > MAX_HISTORY) s.redo.shift()
    return prev
  }

  redo(id: string, current: CanvasSnapshot): CanvasSnapshot | null {
    const s = this.stacks(id)
    const next = s.redo.pop()
    if (!next) return null
    s.undo.push(current)
    if (s.undo.length > MAX_HISTORY) s.undo.shift()
    return next
  }

  canUndo(id: string): boolean { return this.stacks(id).undo.length > 0 }
  canRedo(id: string): boolean { return this.stacks(id).redo.length > 0 }
  clearCanvas(id: string): void { this.map.delete(id) }
  clear(): void { this.map.clear() }
}

export const historyStore = new HistoryStore()
