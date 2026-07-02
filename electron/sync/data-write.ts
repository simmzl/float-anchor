import { getComparableSyncSnapshot } from './summary'

/**
 * 两份数据在「有意义内容」(canvases + activeCanvasId，不含 _syncTimestamp) 上是否一致。
 * 复用 getComparableSyncSnapshot —— 与同步引擎判等口径一致。
 */
export function isSameSyncContent(a: any, b: any): boolean {
  return getComparableSyncSnapshot(a) === getComparableSyncSnapshot(b)
}

/**
 * 写盘前的准备与判定：
 * - 渲染层不传 _syncTimestamp，则从磁盘已有数据回填，保证时间戳不丢。
 * - 若与磁盘已有内容一致 → changed=false，调用方据此跳过写盘（不 bump mtime → 不误触发同步）。
 */
export function prepareDataWrite(
  incoming: any,
  existing: any,
): { changed: boolean; data: any } {
  const data = (incoming && typeof incoming === 'object' && !Array.isArray(incoming))
    ? { ...incoming }
    : incoming

  if (
    data && typeof data === 'object' && !Array.isArray(data) &&
    typeof data._syncTimestamp !== 'number' &&
    existing && typeof existing._syncTimestamp === 'number'
  ) {
    data._syncTimestamp = existing._syncTimestamp
  }

  const changed = !existing || !isSameSyncContent(data, existing)
  return { changed, data }
}
