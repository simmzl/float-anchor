import { randomUUID } from 'node:crypto'
import type { AppData, Connection } from '../types'
import { resolveCanvas, resolveCard } from './refs'
import { mapCanvas } from './_helpers'

export function listConnections(data: AppData, canvasRef: string): Connection[] {
  return resolveCanvas(data, canvasRef).connections ?? []
}

export function addConnection(data: AppData, canvasRef: string, fromRef: string, toRef: string): { data: AppData; connection: Connection } {
  const canvas = resolveCanvas(data, canvasRef)
  const from = resolveCard(canvas, fromRef)
  const to = resolveCard(canvas, toRef)
  if (from.id === to.id) throw new Error('不能连接卡片到自身')
  const exists = (canvas.connections ?? []).some((cn) => cn.fromCardId === from.id && cn.toCardId === to.id)
  if (exists) throw new Error('该连线已存在')
  const connection: Connection = { id: randomUUID(), fromCardId: from.id, toCardId: to.id }
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, connections: [...(c.connections ?? []), connection] })), connection }
}

export function removeConnection(data: AppData, canvasRef: string, connId: string): { data: AppData; removed: Connection } {
  const canvas = resolveCanvas(data, canvasRef)
  const removed = (canvas.connections ?? []).find((cn) => cn.id === connId || cn.id.startsWith(connId))
  if (!removed) throw new Error(`未找到连线：${connId}`)
  return { data: mapCanvas(data, canvas.id, (c) => ({ ...c, connections: (c.connections ?? []).filter((cn) => cn.id !== removed.id) })), removed }
}
