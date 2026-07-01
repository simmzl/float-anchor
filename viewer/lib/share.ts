import type { Snapshot, Canvas } from './types'

export function findSharedCanvas(snapshot: Snapshot, id: string): Canvas | null {
  if (!id) return null
  const canvases = Array.isArray(snapshot?.canvases) ? snapshot.canvases : []
  return canvases.find((c) => c && c.shareId === id) ?? null
}

export function extractImageNames(canvas: Canvas): Set<string> {
  const names = new Set<string>()
  const re = /fa-img:\/\/([^)\s"'<>]+)/g
  for (const card of canvas?.cards ?? []) {
    const content = card?.content ?? ''
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      try { names.add(decodeURIComponent(m[1])) } catch { names.add(m[1]) }
    }
  }
  return names
}
