import { describe, it, expect } from 'vitest'
import { reconcileState, resolveConflict } from './engine'
import type { RemoteAdapter, LocalStore, RemoteImageEntry } from './types'
import type { AppData } from './summary'

function fakeAdapter(init?: { data?: AppData | null }): RemoteAdapter & { _data: AppData | null } {
  let remote: AppData | null = init?.data ?? null
  return {
    _data: remote,
    async test() { return { ok: true } },
    async loadRemoteSnapshot() { return remote ? { data: remote } : null },
    async uploadRemoteSnapshot(data) { remote = JSON.parse(JSON.stringify(data)); this._data = remote; return {} },
    async listRemoteImages(): Promise<RemoteImageEntry[]> { return [] },
    async uploadImage() {},
    async downloadImage() { return Buffer.from([]) },
  }
}

function memStore(init?: { data?: AppData | null; mtime?: number }): LocalStore {
  let data: AppData | null = init?.data ?? null
  let mtime = init?.mtime ?? 0
  return {
    readSnapshot() { return data ? JSON.parse(JSON.stringify(data)) : null },
    writeSnapshot(d) { data = JSON.parse(JSON.stringify(d)) },
    getModifiedAt() { return mtime },
    markSynced(ts) { mtime = ts },
    backup() {},
    listImages() { return [] },
    readImage() { return null },
    writeImage() {},
    getMissingImageNames() { return [] },
    resolveStoredImagePath() { return null },
  }
}

const canvasWith = (over: any) => ({ canvases: [{ id: 'c1', name: 'C', cards: [], ...over }], activeCanvasId: 'c1' })

describe('reconcileState', () => {
  it('远端无快照、本地有数据 → 上传', async () => {
    const store = memStore({ data: { ...canvasWith({ cards: [{}] }), _syncTimestamp: 1 }, mtime: 1 })
    const adapter = fakeAdapter()
    const res = await reconcileState(adapter, store)
    expect(res.action).toBe('uploaded')
    expect(adapter._data?.canvases[0].cards.length).toBe(1)
  })

  it('本地无、远端有有效数据 → 下载', async () => {
    const store = memStore()
    const adapter = fakeAdapter({ data: { ...canvasWith({ cards: [{}] }), _syncTimestamp: 5 } })
    const res = await reconcileState(adapter, store)
    expect(res.action).toBe('downloaded')
  })

  it('指纹一致 → up-to-date', async () => {
    const data = { ...canvasWith({ cards: [{}] }), _syncTimestamp: 3 }
    const res = await reconcileState(fakeAdapter({ data }), memStore({ data, mtime: 3 }))
    expect(res.action).toBe('up-to-date')
  })

  it('本地脏 + 远端更新 → 需确认', async () => {
    const local = { ...canvasWith({ cards: [{}] }), _syncTimestamp: 1 }
    const remote = { ...canvasWith({ cards: [{}, {}] }), _syncTimestamp: 10000 }
    const store = memStore({ data: local, mtime: 999999 }) // mtime 远大于 ts → dirty
    const res = await reconcileState(fakeAdapter({ data: remote }), store)
    expect(res.action).toBe('needs-confirmation')
  })
})

describe('resolveConflict', () => {
  it('keep-local → 上传本地', async () => {
    const store = memStore({ data: { ...canvasWith({ cards: [{}] }), _syncTimestamp: 1 }, mtime: 1 })
    const adapter = fakeAdapter({ data: { ...canvasWith({}), _syncTimestamp: 9 } })
    const res = await resolveConflict(adapter, store, 'keep-local')
    expect(res.action).toBe('uploaded')
    expect(adapter._data?.canvases[0].cards.length).toBe(1)
  })
  it('use-remote → 下载覆盖', async () => {
    const store = memStore({ data: { ...canvasWith({ cards: [{}] }), _syncTimestamp: 1 }, mtime: 1 })
    const adapter = fakeAdapter({ data: { ...canvasWith({ cards: [{}, {}] }), _syncTimestamp: 9 } })
    const res = await resolveConflict(adapter, store, 'use-remote')
    expect(res.action).toBe('downloaded')
    expect(res.data?.canvases[0].cards.length).toBe(2)
  })
})
