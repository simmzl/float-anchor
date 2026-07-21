import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGitHubAdapter, parseRepoFullName } from './github-adapter'

function mockFetch(handler: (url: string, init?: any) => { status?: number; ok?: boolean; json?: any; text?: string; headers?: Record<string, string> }) {
  const calls: { url: string; init?: any }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init })
    const r = handler(url, init)
    const status = r.status ?? 200
    return {
      status,
      ok: r.ok ?? (status >= 200 && status < 300),
      headers: { get: (k: string) => (r.headers || {})[k] ?? null },
      async json() { return r.json },
      async text() { return r.text ?? '' },
      async arrayBuffer() { return new Uint8Array(Buffer.from(r.text ?? '')).buffer },
    } as any
  }))
  return calls
}
afterEach(() => vi.unstubAllGlobals())

const cfg = { repo: 'me/notes', token: 't0ken', branch: 'main' }

describe('GitHubAdapter', () => {
  it('getRemoteTag 返回 sha；404 返回 null', async () => {
    mockFetch((url) => url.includes('float-anchor.json') ? { json: { sha: 'abc123' } } : { status: 404, ok: false })
    expect(await createGitHubAdapter(cfg).getRemoteTag()).toBe('abc123')

    mockFetch(() => ({ status: 404, ok: false }))
    expect(await createGitHubAdapter(cfg).getRemoteTag()).toBeNull()
  })

  it('loadRemoteSnapshot 解析内联 base64 + 返回 tag', async () => {
    const data = { canvases: [{ id: 'c1', cards: [] }], activeCanvasId: 'c1', _syncTimestamp: 7 }
    const content = Buffer.from(JSON.stringify(data)).toString('base64')
    mockFetch(() => ({ json: { sha: 's1', content, encoding: 'base64' } }))
    const res = await createGitHubAdapter(cfg).loadRemoteSnapshot()
    expect(res?.tag).toBe('s1')
    expect(res?.data.canvases.length).toBe(1)
  })

  it('uploadRemoteSnapshot PUT 带 sha 并请求头含 Bearer', async () => {
    const calls = mockFetch((url, init) => {
      if (init?.method === 'PUT') return { json: { content: { sha: 'new9' } } }
      return { json: { sha: 'old1' } } // getRemoteTag 预热缓存
    })
    const a = createGitHubAdapter(cfg)
    await a.getRemoteTag() // 缓存 old1
    const r = await a.uploadRemoteSnapshot({ canvases: [], activeCanvasId: null } as any)
    expect(r.tag).toBe('new9')
    const put = calls.find((c) => c.init?.method === 'PUT')!
    expect(JSON.parse(put.init.body).sha).toBe('old1')
    expect(put.init.headers.Authorization).toBe('Bearer t0ken')
  })

  it('冷启动上传（无缓存 sha、远端已有文件）→ 先查 sha 再 PUT', async () => {
    // 对应「解决冲突 keep-local」场景：IPC 新建 adapter，shaCache 为空，直接上传。
    // 修复前：PUT 不带 sha → GitHub 422（更新已存在文件必须带 blob sha）。
    const calls = mockFetch((url, init) => {
      if (init?.method === 'PUT') return { json: { content: { sha: 'new1' } } }
      return { json: { sha: 'cold1' } } // GET 元数据
    })
    const a = createGitHubAdapter(cfg)
    const r = await a.uploadRemoteSnapshot({ canvases: [], activeCanvasId: null } as any)
    expect(r.tag).toBe('new1')
    const put = calls.find((c) => c.init?.method === 'PUT')!
    expect(JSON.parse(put.init.body).sha).toBe('cold1')
  })

  it('冷启动上传且远端不存在该文件（404）→ 不带 sha 直接创建', async () => {
    const calls = mockFetch((url, init) => {
      if (init?.method === 'PUT') return { json: { content: { sha: 'created1' } } }
      return { status: 404, ok: false }
    })
    const r = await createGitHubAdapter(cfg).uploadRemoteSnapshot({ canvases: [], activeCanvasId: null } as any)
    expect(r.tag).toBe('created1')
    const put = calls.find((c) => c.init?.method === 'PUT')!
    expect(JSON.parse(put.init.body).sha).toBeUndefined()
  })

  it('PUT 遇 409/422（sha 过期竞态）→ 刷新 sha 重试一次', async () => {
    let puts = 0
    const calls = mockFetch((url, init) => {
      if (init?.method === 'PUT') {
        puts++
        if (puts === 1) return { status: 422, ok: false, json: {} }
        return { json: { content: { sha: 'new2' } } }
      }
      // GET sha：第一次（冷启动预取）返回过期 sha，重试刷新时返回新 sha
      return { json: { sha: puts === 0 ? 'stale1' : 'fresh2' } }
    })
    const a = createGitHubAdapter(cfg)
    const r = await a.uploadRemoteSnapshot({ canvases: [], activeCanvasId: null } as any)
    expect(r.tag).toBe('new2')
    const putCalls = calls.filter((c) => c.init?.method === 'PUT')
    expect(putCalls.length).toBe(2)
    expect(JSON.parse(putCalls[1].init.body).sha).toBe('fresh2')
  })

  it('PUT 重试仍失败 → 抛错（不无限重试）', async () => {
    let puts = 0
    mockFetch((url, init) => {
      if (init?.method === 'PUT') { puts++; return { status: 409, ok: false, json: {} } }
      return { json: { sha: `s${puts}` } }
    })
    const a = createGitHubAdapter(cfg)
    await expect(a.uploadRemoteSnapshot({ canvases: [], activeCanvasId: null } as any)).rejects.toThrow('GitHub 409')
    expect(puts).toBe(2)
  })

  it('listRemoteImages 过滤 file；404 返回 []', async () => {
    mockFetch(() => ({ json: [{ type: 'file', name: 'a.png', size: 3, sha: 'i1' }, { type: 'dir', name: 'x' }] }))
    expect(await createGitHubAdapter(cfg).listRemoteImages()).toEqual([{ name: 'a.png', size: 3 }])
    mockFetch(() => ({ status: 404, ok: false }))
    expect(await createGitHubAdapter(cfg).listRemoteImages()).toEqual([])
  })

  it('含空格文件名: uploadImage 与 downloadImage URL 路径均含 %20 且一致', async () => {
    const calls = mockFetch((url, init) => {
      if (init?.method === 'PUT') return { json: { content: { sha: 'sha-img' } } }
      // fetchSha 预热: 404 使 uploadImage 跳过 sha; downloadImage 需返回 ok+二进制
      if (init?.headers?.Accept === 'application/vnd.github.raw') return { ok: true, text: '\x01\x02\x03' }
      return { status: 404, ok: false }
    })
    const a = createGitHubAdapter(cfg)

    await a.uploadImage('a b.png', Buffer.from([1, 2, 3]))
    await a.downloadImage('a b.png')

    // PUT URL 含编码后的 a%20b.png
    const putCall = calls.find((c) => c.init?.method === 'PUT')!
    expect(putCall.url).toContain('a%20b.png')

    // downloadImage GET URL（raw Accept）也含编码后的 a%20b.png
    const dlCall = calls.find((c) => c.init?.headers?.Accept === 'application/vnd.github.raw')!
    expect(dlCall.url).toContain('a%20b.png')

    // 两者路径中图片段一致
    const segment = (url: string) => url.split('images/')[1]?.split('?')[0]
    expect(segment(putCall.url)).toBe(segment(dlCall.url))
  })
})

describe('parseRepoFullName', () => {
  it('owner/repo → 解析出两段', () => {
    expect(parseRepoFullName('simmzl/float-anchor-sync-data')).toEqual({ owner: 'simmzl', repo: 'float-anchor-sync-data' })
  })
  it('缺 owner 前缀（仅仓库名）→ null', () => {
    expect(parseRepoFullName('float-anchor-sync-data')).toBeNull()
  })
  it('空串 / 多段 / 半边为空 → null', () => {
    expect(parseRepoFullName('')).toBeNull()
    expect(parseRepoFullName('a/b/c')).toBeNull()
    expect(parseRepoFullName('owner/')).toBeNull()
    expect(parseRepoFullName('/repo')).toBeNull()
  })
  it('去除首尾斜杠与空格', () => {
    expect(parseRepoFullName('  simmzl/repo/  ')).toEqual({ owner: 'simmzl', repo: 'repo' })
  })
})

describe('createGitHubAdapter.test() — 仓库格式校验', () => {
  it('缺 owner 前缀 → 明确报错，且不发网络请求', async () => {
    const calls = mockFetch(() => ({ ok: true }))
    const r = await createGitHubAdapter({ repo: 'float-anchor-sync-data', token: 't' }).test()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('owner/仓库名')
    expect(calls.length).toBe(0)
  })
})
