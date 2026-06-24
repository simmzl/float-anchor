import { normalizeSyncData } from './summary'
import type { AppData } from './summary'
import type { RemoteAdapter, RemoteImageEntry } from './types'
import { getAccessToken } from './onedrive-auth'
import { GRAPH_BASE } from './onedrive-config'

const SNAPSHOT_ITEM = '/me/drive/special/approot:/float-anchor.json'
const IMAGES_FOLDER = '/me/drive/special/approot:/images'

async function graph(pathPart: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken()
  const resp = await fetch(`${GRAPH_BASE}${pathPart}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  })
  if (resp.status === 429 && retry) {
    const wait = Number(resp.headers.get('Retry-After') || '5') * 1000
    await new Promise((r) => setTimeout(r, wait))
    return graph(pathPart, init, false)
  }
  return resp
}

export function createOneDriveAdapter(): RemoteAdapter {
  return {
    async test() {
      try {
        const resp = await graph('/me/drive/special/approot')
        return resp.ok ? { ok: true } : { ok: false, error: `Graph ${resp.status}` }
      } catch (err) { return { ok: false, error: String(err) } }
    },

    async getRemoteTag(): Promise<string | null> {
      const resp = await graph(`${SNAPSHOT_ITEM}?$select=eTag`)
      if (resp.status === 404) return null
      if (!resp.ok) return null
      const item = await resp.json()
      return item.eTag || null
    },

    async loadRemoteSnapshot(): Promise<{ data: AppData; tag?: string } | null> {
      const metaResp = await graph(`${SNAPSHOT_ITEM}?$select=eTag`)
      if (metaResp.status === 404) return null
      const tag = metaResp.ok ? (await metaResp.json()).eTag : undefined
      const resp = await graph(`${SNAPSHOT_ITEM}:/content`)
      if (resp.status === 404) return null
      if (!resp.ok) throw new Error(`下载快照失败 Graph ${resp.status}`)
      const text = await resp.text()
      return { data: normalizeSyncData(JSON.parse(text)), tag }
    },

    async uploadRemoteSnapshot(data: AppData, opts?: { ifMatch?: string }) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch
      const resp = await graph(`${SNAPSHOT_ITEM}:/content`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data, null, 2),
      })
      if (!resp.ok) throw new Error(`上传快照失败 Graph ${resp.status}`)
      const item = await resp.json()
      return { tag: item.eTag }
    },

    async listRemoteImages(): Promise<RemoteImageEntry[]> {
      const resp = await graph(`${IMAGES_FOLDER}:/children?$select=name,size`)
      if (resp.status === 404) return []
      if (!resp.ok) return []
      const json = await resp.json()
      return (json.value || [])
        .filter((it: any) => !it.folder)
        .map((it: any) => ({ name: it.name, size: it.size || 0 }))
    },

    async uploadImage(name: string, buf: Buffer) {
      const resp = await graph(`${IMAGES_FOLDER}/${encodeURIComponent(name)}:/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(buf),
      })
      if (!resp.ok) throw new Error(`上传图片失败 Graph ${resp.status}`)
    },

    async downloadImage(name: string): Promise<Buffer> {
      const resp = await graph(`${IMAGES_FOLDER}/${encodeURIComponent(name)}:/content`)
      if (!resp.ok) throw new Error(`下载图片失败 Graph ${resp.status}`)
      return Buffer.from(await resp.arrayBuffer())
    },
  }
}
