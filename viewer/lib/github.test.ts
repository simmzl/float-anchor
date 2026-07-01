import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchSnapshot, contentTypeForName, __resetSnapshotCache } from './github'

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

describe('contentTypeForName', () => {
  it('按扩展名给 content-type', () => {
    expect(contentTypeForName('a.png')).toBe('image/png')
    expect(contentTypeForName('a.jpg')).toBe('image/jpeg')
    expect(contentTypeForName('a.webp')).toBe('image/webp')
    expect(contentTypeForName('a.bin')).toBe('application/octet-stream')
  })
})

describe('fetchSnapshot', () => {
  beforeEach(() => {
    __resetSnapshotCache()
    vi.stubEnv('GITHUB_TOKEN', 't'); vi.stubEnv('GITHUB_REPO', 'o/r'); vi.stubEnv('GITHUB_BRANCH', 'main')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('解析 base64 快照，并在 TTL 内缓存（只请求一次）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: b64(JSON.stringify({ canvases: [{ id: 'a', name: 'A', cards: [], shareId: 'S' }], activeCanvasId: 'a' })), encoding: 'base64' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const s1 = await fetchSnapshot()
    const s2 = await fetchSnapshot()
    expect(s1.canvases[0].shareId).toBe('S')
    expect(s2).toBe(s1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 缓存命中
  })
})
