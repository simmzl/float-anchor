import type { Canvas, Card, TextBox, CanvasLabel, Section, Connection } from './types'
import { useStore } from './store'

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

export const IDLE_MS = 400

const burstActive = new Map<string, boolean>()
const burstTimers = new Map<string, ReturnType<typeof setTimeout>>()

function endBurst(id: string): void {
  burstActive.set(id, false)
  const t = burstTimers.get(id)
  if (t) { clearTimeout(t); burstTimers.delete(id) }
}

export function flushBurst(id: string): void {
  endBurst(id)
}

function scheduleEnd(id: string): void {
  const existing = burstTimers.get(id)
  if (existing) clearTimeout(existing)
  burstTimers.set(id, setTimeout(() => endBurst(id), IDLE_MS))
}

export function initHistory(): () => void {
  const unsub = useStore.subscribe((state, prev) => {
    if (state.suppressHistory) return

    const editingNow = !!(state.editingCardId || state.editingTextId)
    const editingBefore = !!(prev.editingCardId || prev.editingTextId)

    // 编辑刚结束 → 给活动画布安排 burst 收尾（把随后的高度自适应并入同一条）
    if (editingBefore && !editingNow && state.activeCanvasId) {
      scheduleEnd(state.activeCanvasId)
    }

    if (state.canvases === prev.canvases) return

    for (const cur of state.canvases) {
      const before = prev.canvases.find((c) => c.id === cur.id)
      if (!before || before === cur) continue // 新画布或该画布未变

      if (burstActive.get(cur.id)) {
        if (!editingNow) scheduleEnd(cur.id) // 已在 burst 内：仅续期（编辑期间不收尾）
        continue
      }

      if (contentFingerprint(before) === contentFingerprint(cur)) continue // 仅 viewport 等非内容变化

      historyStore.record(cur.id, snapshotCanvas(before))
      burstActive.set(cur.id, true)
      if (!editingNow) scheduleEnd(cur.id)
    }
  })

  return () => {
    unsub()
    for (const t of burstTimers.values()) clearTimeout(t)
    burstTimers.clear()
    burstActive.clear()
  }
}
