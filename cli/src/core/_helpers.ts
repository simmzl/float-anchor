import type { AppData, Canvas } from '../types'

export class RefError extends Error {}

export function mapCanvas(data: AppData, canvasId: string, fn: (c: Canvas) => Canvas): AppData {
  return { ...data, canvases: data.canvases.map((c) => c.id === canvasId ? fn(c) : c) }
}

export function findById<T extends { id: string }>(items: T[] | undefined, ref: string, kind: string, nameMatch?: (t: T) => boolean): T {
  const list = items ?? []
  const byId = list.find((i) => i.id === ref)
  if (byId) return byId
  if (nameMatch) { const byName = list.filter(nameMatch); if (byName.length === 1) return byName[0] }
  const byPrefix = list.filter((i) => i.id.startsWith(ref))
  if (byPrefix.length === 1) return byPrefix[0]
  if (byPrefix.length > 1) throw new RefError(`${kind}引用「${ref}」有歧义：${byPrefix.map((i) => i.id).join(', ')}`)
  throw new RefError(`未找到${kind}：${ref}`)
}
