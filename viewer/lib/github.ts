import type { Snapshot } from './types'

const API = 'https://api.github.com'
const TTL_MS = 45_000

function cfg() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  if (!token || !repo) throw new Error('缺少 GITHUB_TOKEN / GITHUB_REPO 环境变量')
  const [owner, name] = repo.split('/')
  return { token, owner, name, branch }
}

function headers(token: string, raw = false) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

let cache: { data: Snapshot; at: number } | null = null
export function __resetSnapshotCache() { cache = null }

export async function fetchSnapshot(): Promise<Snapshot> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.data
  const { token, owner, name, branch } = cfg()
  const url = `${API}/repos/${owner}/${name}/contents/float-anchor.json?ref=${encodeURIComponent(branch)}`
  const resp = await fetch(url, { headers: headers(token), cache: 'no-store' })
  if (!resp.ok) throw new Error(`GitHub ${resp.status}`)
  const meta = await resp.json()
  const text = Buffer.from(meta.content, 'base64').toString('utf-8')
  const data = JSON.parse(text) as Snapshot
  cache = { data, at: now }
  return data
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.svg': 'image/svg+xml',
}
export function contentTypeForName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}

export async function fetchImage(name: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { token, owner, name: repo, branch } = cfg()
  const url = `${API}/repos/${owner}/${repo}/contents/${encodePath(`images/${name}`)}?ref=${encodeURIComponent(branch)}`
  const resp = await fetch(url, { headers: headers(token, true), cache: 'no-store' })
  if (!resp.ok) throw new Error(`GitHub ${resp.status}`)
  const buf = new Uint8Array(await resp.arrayBuffer())
  return { bytes: buf, contentType: contentTypeForName(name) }
}
