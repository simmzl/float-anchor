# GitHub 同步（Contents API + PAT）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 GitHub 同步后端（Contents API + fine-grained PAT），复用现有 provider 无关引擎/冲突/状态/快路径，blob sha 同时驱动「远端未变跳过下载」与上传乐观并发。

**Architecture:** 实现 `GitHubAdapter`（`RemoteAdapter`），PAT 经 safeStorage 加密存盘；`getActiveAdapter` 加 github 分支；设置面板加 GitHub 选项 + 子面板。坚果云行为零回归。

**Tech Stack:** Electron 28（主进程全局 `fetch` + `safeStorage`）、GitHub REST Contents API v2022-11-28、TypeScript、React、vitest。

## Global Constraints

- 语言：面向用户文案简体中文。
- PAT 安全：经 `safeStorage` 加密存独立文件 `<userData>/data/github-token.bin`，**不进** settings.json、不打日志。
- 认证：fine-grained PAT，权限 `Contents: write`；无 OAuth。
- 快照：明文 JSON（不 gzip），路径 `float-anchor.json`、图片 `images/{name}`，分支默认 `main` 可配。
- 更新文件必须带当前 blob `sha`（乐观并发）；sha 同时作为 `getRemoteTag` 返回的变更标签。
- 纯逻辑模块不在顶层 import electron；adapter 用全局 `fetch`。
- electron/ 类型检查用临时 strict tsconfig（项目默认 tsc 不覆盖 electron/，且 main.ts 有一条**既有无关** TS2339(prepare-clear-all-data)，验证时排除）。
- 提交 message 中文 `feat:/refactor:/fix:/test:` 前缀。
- 测试仓库：`simmzl/float-anchor-sync-test`（私有，已建，默认分支 main）；真机验证用 `gh auth token` 的令牌。
- 设计依据：`docs/superpowers/specs/2026-06-25-github-sync-design.md`。

### electron 类型检查命令（多处复用）
```bash
cd "$(git rev-parse --show-toplevel)"
cat > tsconfig.electron-check.json <<'JSON'
{ "compilerOptions": { "target":"ES2020","lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","moduleResolution":"bundler","skipLibCheck":true,"resolveJsonModule":true,"strict":true,"noEmit":true,"esModuleInterop":true,"types":["node"] }, "include":["electron"] }
JSON
npx tsc --noEmit -p tsconfig.electron-check.json 2>&1 | grep "error TS" | grep -v "main.ts(79\|prepare-clear"
rm -f tsconfig.electron-check.json tsconfig.node.tsbuildinfo
# 无输出 = 除既有 main.ts clear-data 错误外类型干净
```

---

### Task 1: GitHubAdapter（Contents API）+ fetch-mock 单测 + 真机冒烟

**Files:**
- Create: `electron/sync/github-adapter.ts`
- Create: `electron/sync/github-adapter.test.ts`

**Interfaces:**
- Consumes: `./summary`(normalizeSyncData/AppData)、`./types`(RemoteAdapter/RemoteImageEntry)。
- Produces: `createGitHubAdapter(config: { repo: string; token: string; branch?: string }): RemoteAdapter`。

- [ ] **Step 1: 写 github-adapter.ts**

Create `electron/sync/github-adapter.ts`:
```ts
import { normalizeSyncData } from './summary'
import type { AppData } from './summary'
import type { RemoteAdapter, RemoteImageEntry } from './types'

const API = 'https://api.github.com'
const SNAPSHOT_PATH = 'float-anchor.json'
const IMAGES_DIR = 'images'

export interface GitHubConfig { repo: string; token: string; branch?: string }

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export function createGitHubAdapter(config: GitHubConfig): RemoteAdapter {
  const slash = config.repo.trim().replace(/^\/+|\/+$/g, '')
  const [owner, repo] = slash.split('/')
  const branch = config.branch || 'main'
  const base = `${API}/repos/${owner}/${repo}/contents`
  // 实例内缓存各路径 blob sha（更新必带）。同一次 runSync 复用同一 adapter 实例，故上传时 sha 新鲜。
  const shaCache = new Map<string, string>()

  async function ghFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const resp = await fetch(url, { ...init, headers: { ...authHeaders(config.token), ...(init.headers || {}) } })
    // 速率受限(remaining=0)退避一次
    if ((resp.status === 403 || resp.status === 429) && retry && resp.headers.get('X-RateLimit-Remaining') === '0') {
      const reset = Number(resp.headers.get('X-RateLimit-Reset') || '0') * 1000
      const wait = Math.min(Math.max(reset - Date.now(), 1000), 10000)
      await new Promise((r) => setTimeout(r, wait))
      return ghFetch(url, init, false)
    }
    return resp
  }

  const contentUrl = (path: string) => `${base}/${path}?ref=${encodeURIComponent(branch)}`

  async function fetchSha(path: string): Promise<string | null> {
    const resp = await ghFetch(contentUrl(path))
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error(`GitHub ${resp.status}`)
    const meta = await resp.json()
    if (meta?.sha) shaCache.set(path, meta.sha)
    return meta?.sha || null
  }

  async function putFile(path: string, base64: string, message: string): Promise<string | undefined> {
    const body: Record<string, unknown> = { message, content: base64, branch }
    const sha = shaCache.get(path)
    if (sha) body.sha = sha
    const resp = await ghFetch(`${base}/${path}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(`GitHub ${resp.status}`)
    const json = await resp.json()
    const newSha = json?.content?.sha
    if (newSha) shaCache.set(path, newSha)
    return newSha
  }

  return {
    async test() {
      try {
        const resp = await ghFetch(`${API}/repos/${owner}/${repo}`)
        return resp.ok ? { ok: true } : { ok: false, error: `GitHub ${resp.status}` }
      } catch (err) { return { ok: false, error: String(err) } }
    },

    async getRemoteTag() {
      return fetchSha(SNAPSHOT_PATH)
    },

    async loadRemoteSnapshot(): Promise<{ data: AppData; tag?: string } | null> {
      const metaResp = await ghFetch(contentUrl(SNAPSHOT_PATH))
      if (metaResp.status === 404) return null
      if (!metaResp.ok) throw new Error(`GitHub ${metaResp.status}`)
      const meta = await metaResp.json()
      if (meta?.sha) shaCache.set(SNAPSHOT_PATH, meta.sha)
      let text: string
      if (meta?.content && meta.encoding === 'base64') {
        text = Buffer.from(meta.content, 'base64').toString('utf-8')
      } else {
        const rawResp = await ghFetch(contentUrl(SNAPSHOT_PATH), { headers: { Accept: 'application/vnd.github.raw' } })
        if (!rawResp.ok) throw new Error(`GitHub ${rawResp.status}`)
        text = await rawResp.text()
      }
      return { data: normalizeSyncData(JSON.parse(text)), tag: meta?.sha }
    },

    async uploadRemoteSnapshot(data: AppData) {
      const base64 = Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64')
      const newSha = await putFile(SNAPSHOT_PATH, base64, 'FloatAnchor: 同步快照')
      return { tag: newSha }
    },

    async listRemoteImages(): Promise<RemoteImageEntry[]> {
      const resp = await ghFetch(contentUrl(IMAGES_DIR))
      if (resp.status === 404) return []
      if (!resp.ok) return []
      const arr = await resp.json()
      if (!Array.isArray(arr)) return []
      const out: RemoteImageEntry[] = []
      for (const it of arr) {
        if (it?.type === 'file' && it.name) {
          if (it.sha) shaCache.set(`${IMAGES_DIR}/${it.name}`, it.sha)
          out.push({ name: it.name, size: it.size ?? 0 })
        }
      }
      return out
    },

    async uploadImage(name: string, buf: Buffer) {
      const path = `${IMAGES_DIR}/${name}`
      if (!shaCache.has(path)) { try { await fetchSha(path) } catch {} }
      await putFile(path, buf.toString('base64'), 'FloatAnchor: 图片')
    },

    async downloadImage(name: string): Promise<Buffer> {
      const resp = await ghFetch(contentUrl(`${IMAGES_DIR}/${encodeURIComponent(name)}`), {
        headers: { Accept: 'application/vnd.github.raw' },
      })
      if (!resp.ok) throw new Error(`GitHub ${resp.status}`)
      return Buffer.from(await resp.arrayBuffer())
    },
  }
}
```

- [ ] **Step 2: 写 fetch-mock 单测**

Create `electron/sync/github-adapter.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGitHubAdapter } from './github-adapter'

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

  it('listRemoteImages 过滤 file；404 返回 []', async () => {
    mockFetch(() => ({ json: [{ type: 'file', name: 'a.png', size: 3, sha: 'i1' }, { type: 'dir', name: 'x' }] }))
    expect(await createGitHubAdapter(cfg).listRemoteImages()).toEqual([{ name: 'a.png', size: 3 }])
    mockFetch(() => ({ status: 404, ok: false }))
    expect(await createGitHubAdapter(cfg).listRemoteImages()).toEqual([])
  })
})
```

- [ ] **Step 3: 运行单测（应全绿）**

Run: `npm test`
Expected: 新增 4 个测试通过，总数 35。

- [ ] **Step 4: electron 类型检查**

运行 Global Constraints 的 electron 类型检查命令。Expected: 除既有 main.ts 错误外无输出。

- [ ] **Step 5: 真机冒烟（用 gh 令牌打真实测试仓库）**

写一次性脚本到 scratchpad（不提交），用 `gh auth token` 的令牌对 `simmzl/float-anchor-sync-test` 跑 adapter 的 test/getRemoteTag/upload/load 往返：
```bash
cd "$(git rev-parse --show-toplevel)"
TOKEN="$(gh auth token)"
cat > /tmp/gh-smoke.mjs <<'EOF'
import { createGitHubAdapter } from './electron/sync/github-adapter.ts'
EOF
# 注：.ts 不能直接被 node 跑。改用 vitest 临时用例或 tsx。
```
**实际做法**：在 `github-adapter.test.ts` 末尾临时加一个 `it.skipIf(!process.env.GH_SMOKE)('真机往返', ...)` 用例（用真实 fetch，不 mock），repo=`simmzl/float-anchor-sync-test`，token=`process.env.GH_TOKEN`：上传 `{canvases:[{id:'c1',cards:[{}]}],activeCanvasId:'c1'}` → loadRemoteSnapshot 读回断言 canvases 长度 1、getRemoteTag 非空。运行：
```bash
GH_SMOKE=1 GH_TOKEN="$(gh auth token)" npx vitest run electron/sync/github-adapter.test.ts
```
Expected: 真机往返通过。验证后**移除该 skipIf 用例**（不提交真机用例，避免 CI 依赖网络/令牌），保留前 4 个 mock 用例。在报告中贴真机往返输出。

- [ ] **Step 6: 提交**

```bash
git add electron/sync/github-adapter.ts electron/sync/github-adapter.test.ts
git commit -m "feat: GitHubAdapter（Contents API + sha 乐观并发）+ 单测"
```

---

### Task 2: GitHub PAT 加密存储

**Files:**
- Create: `electron/sync/github-auth.ts`

**Interfaces:**
- Produces: `initGitHubAuth(filePath: string)`、`saveGitHubToken(token: string)`、`readGitHubToken(): string | null`、`clearGitHubToken()`、`hasGitHubToken(): boolean`。

- [ ] **Step 1: 写 github-auth.ts**

Create `electron/sync/github-auth.ts`:
```ts
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'

let tokenFilePath = ''
export function initGitHubAuth(filePath: string) { tokenFilePath = filePath }

export function saveGitHubToken(token: string) {
  if (!tokenFilePath) return
  try {
    if (!fs.existsSync(path.dirname(tokenFilePath))) fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true })
    // safeStorage 不可用时(如无 keyring 的 Linux)降级明文存储，属 Electron 既有模型权衡
    const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf-8')
    fs.writeFileSync(tokenFilePath, enc)
  } catch (err) { console.error('saveGitHubToken failed:', err) }
}

export function readGitHubToken(): string | null {
  try {
    if (!tokenFilePath || !fs.existsSync(tokenFilePath)) return null
    const buf = fs.readFileSync(tokenFilePath)
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch { return null }
}

export function clearGitHubToken() {
  try { if (tokenFilePath && fs.existsSync(tokenFilePath)) fs.unlinkSync(tokenFilePath) } catch {}
}

export function hasGitHubToken(): boolean {
  return !!tokenFilePath && fs.existsSync(tokenFilePath)
}
```

- [ ] **Step 2: electron 类型检查**

运行 electron 类型检查命令。Expected: 除既有 main.ts 错误外无输出。`npm test` 仍 35 绿。

- [ ] **Step 3: 提交**

```bash
git add electron/sync/github-auth.ts
git commit -m "feat: GitHub PAT 经 safeStorage 加密存储"
```

---

### Task 3: main.ts 接入 GitHub（getActiveAdapter + IPC + 错误映射 + init）

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: Task 1 `createGitHubAdapter`、Task 2 github-auth、`settings.github`(Task 4 类型，运行期为 `{repo, branch?}`)。
- Produces IPC：`github-test`、`github-save-token`、`github-clear-token`、`github-has-token`、`github-account`。

- [ ] **Step 1: import + init**

`electron/main.ts` 顶部加：
```ts
import { createGitHubAdapter } from './sync/github-adapter'
import { initGitHubAuth, saveGitHubToken, readGitHubToken, clearGitHubToken, hasGitHubToken } from './sync/github-auth'
```
在 app 就绪、`getDataPaths()` 可用处（与既有 ensureDataDir/createWindow 同时序）加：
```ts
initGitHubAuth(path.join(getDataPaths().dataDir, 'github-token.bin'))
```

- [ ] **Step 2: getActiveAdapter 加 github 分支**

`getActiveAdapter()` 内，在 webdav 分支后、`return null` 前加：
```ts
  if (provider === 'github' && settings?.github?.repo && hasGitHubToken()) {
    const token = readGitHubToken()
    if (token) return createGitHubAdapter({ repo: settings.github.repo, token, branch: settings.github.branch })
  }
```
（`provider` 变量已是 `settings?.syncProvider ?? (settings?.webdav?.server ? 'webdav' : 'none')`。）

- [ ] **Step 3: describeSyncError 加 GitHub 分支**

在 `describeSyncError` 内，`status===403` 分支**之前**加更精确的 GitHub 判断（保持顺序）：
```ts
  if (status === 401) return 'GitHub 令牌无效或权限不足'
  if (status === 409 || status === 422) return '云端已更新，正在重新同步'
```
并把现有 403 文案保持（坚果云/GitHub 通用「流量/请求超限」）；404 现有文案改为通用「云端文件或仓库不存在」。（仅调整文案，不破坏既有映射。）

- [ ] **Step 4: 加 github-* IPC**

```ts
ipcMain.handle('github-test', async (_e, c: { repo: string; token: string; branch?: string }) => {
  const r = await createGitHubAdapter(c).test()
  return r.ok ? { success: true } : { success: false, error: r.error }
})
ipcMain.handle('github-save-token', async (_e, token: string) => { saveGitHubToken(token); return { success: true } })
ipcMain.handle('github-clear-token', async () => { clearGitHubToken(); return { success: true } })
ipcMain.handle('github-has-token', async () => ({ has: hasGitHubToken() }))
ipcMain.handle('github-account', async () => {
  const token = readGitHubToken()
  if (!token) return { login: null }
  try {
    const resp = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } })
    if (!resp.ok) return { login: null }
    const u = await resp.json()
    return { login: u.login || null }
  } catch { return { login: null } }
})
```

- [ ] **Step 5: 校验**

运行 electron 类型检查命令（除既有 main.ts 错误外无输出）。`npm test` 仍 35 绿。

- [ ] **Step 6: 提交**

```bash
git add electron/main.ts
git commit -m "feat: main 接入 GitHub provider + 认证 IPC + 错误映射"
```

---

### Task 4: preload + types

**Files:**
- Modify: `electron/preload.ts`、`src/types.ts`

**Interfaces:**
- Produces: `window.electronAPI.githubTest/githubSaveToken/githubClearToken/githubHasToken/githubAccount`；`SyncProvider` 加 `'github'`；`AppSettings.github`。

- [ ] **Step 1: preload 暴露**

`electron/preload.ts` 加：
```ts
  githubTest: (c: any) => ipcRenderer.invoke('github-test', c),
  githubSaveToken: (token: string) => ipcRenderer.invoke('github-save-token', token),
  githubClearToken: () => ipcRenderer.invoke('github-clear-token'),
  githubHasToken: () => ipcRenderer.invoke('github-has-token'),
  githubAccount: () => ipcRenderer.invoke('github-account'),
```

- [ ] **Step 2: types.ts**

`src/types.ts`：
- `SyncProvider` 改为 `'webdav' | 'github' | 'none'`。
- `AppSettings` 加：`github?: { repo: string; branch?: string }`。
- `window.electronAPI` 加：
```ts
      githubTest: (c: { repo: string; token: string; branch?: string }) => Promise<{ success: boolean; error?: string }>
      githubSaveToken: (token: string) => Promise<{ success: boolean }>
      githubClearToken: () => Promise<{ success: boolean }>
      githubHasToken: () => Promise<{ has: boolean }>
      githubAccount: () => Promise<{ login: string | null }>
```

- [ ] **Step 3: 校验**

`npx tsc --noEmit -p tsconfig.json` 无报错；electron 类型检查除既有错误外无输出；`npm test` 35 绿。

- [ ] **Step 4: 提交**

```bash
git add electron/preload.ts src/types.ts
git commit -m "feat: preload/types 增加 GitHub 同步接口与 provider"
```

---

### Task 5: 设置面板 GitHub 选项 + 子面板

**Files:**
- Modify: `src/components/SettingsModal.tsx`、`src/index.css`

**Interfaces:**
- Consumes: Task 4 github IPC + `settings.github`。
- Produces: provider 选择器三选一（坚果云 / GitHub / 关闭）+ GitHub 子面板。

- [ ] **Step 1: provider 选择器加 GitHub 按钮**

`src/components/SettingsModal.tsx` 的 `.provider-switcher` 内，在「坚果云 WebDAV」与「关闭」之间加：
```tsx
<button className={`provider-option ${syncProvider === 'github' ? 'active' : ''}`} onClick={() => useStore.getState().setSyncProvider('github')}>GitHub</button>
```
（`syncProvider` 已是 `getEffectiveProvider(settings)`。）

- [ ] **Step 2: 加 GitHub 子面板 state + 逻辑**

在组件内加：
```tsx
const [ghRepo, setGhRepo] = useState(settings.github?.repo || '')
const [ghBranch, setGhBranch] = useState(settings.github?.branch || 'main')
const [ghToken, setGhToken] = useState('')
const [ghConnected, setGhConnected] = useState(false)
const [ghAccount, setGhAccount] = useState<string | null>(null)
const [ghTest, setGhTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')

useEffect(() => {
  window.electronAPI.githubHasToken().then((r) => {
    setGhConnected(r.has)
    if (r.has) window.electronAPI.githubAccount().then((a) => setGhAccount(a.login))
  })
}, [])

const handleGithubSave = useCallback(async () => {
  if (!ghRepo.trim() || !ghToken.trim()) return
  setGhTest('testing')
  const res = await window.electronAPI.githubTest({ repo: ghRepo.trim(), token: ghToken.trim(), branch: ghBranch.trim() || 'main' })
  if (!res.success) { setGhTest('fail'); setTimeout(() => setGhTest('idle'), 3000); return }
  setGhTest('ok')
  await window.electronAPI.githubSaveToken(ghToken.trim())
  const s = { ...useStore.getState().settings, github: { repo: ghRepo.trim(), branch: ghBranch.trim() || 'main' } }
  await useStore.getState().saveSettings(s)
  useStore.getState().setSyncProvider('github')
  setGhConnected(true); setGhToken('')
  window.electronAPI.githubAccount().then((a) => setGhAccount(a.login))
  useStore.getState().setSyncStatus('syncing')
  window.electronAPI.syncAuto().then((r) => applySyncResult(r)).catch(() => useStore.getState().setSyncStatus('error', '同步失败'))
}, [applySyncResult, ghRepo, ghBranch, ghToken])

const handleGithubDisconnect = useCallback(async () => {
  await window.electronAPI.githubClearToken()
  useStore.getState().setSyncProvider('none')
  setGhConnected(false); setGhAccount(null)
}, [])
```

- [ ] **Step 3: 渲染 GitHub 子面板**

在 provider 选择器后加：
```tsx
{syncProvider === 'github' && (
  <div className="github-panel">
    {ghConnected ? (
      <>
        <div className="onedrive-account">已连接：{ghAccount || 'GitHub'} · {settings.github?.repo}</div>
        <div className="webdav-actions">
          <button onClick={handleManualSync} disabled={syncStatus === 'syncing' || !!syncDecision}>同步</button>
          <button onClick={handleGithubDisconnect}>断开</button>
        </div>
        <div className="data-hint">提交历史可在 GitHub 仓库网页查看。</div>
      </>
    ) : (
      <>
        <div className="webdav-field"><label>仓库 (owner/repo)</label>
          <input value={ghRepo} onChange={(e) => setGhRepo(e.target.value)} placeholder="yourname/float-anchor-data" /></div>
        <div className="webdav-field"><label>分支</label>
          <input value={ghBranch} onChange={(e) => setGhBranch(e.target.value)} placeholder="main" /></div>
        <div className="webdav-field"><label>访问令牌 (PAT)</label>
          <input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="fine-grained PAT, Contents 读写" /></div>
        <div className="webdav-actions">
          <button className="primary" onClick={handleGithubSave} disabled={ghTest === 'testing'}>
            {ghTest === 'testing' ? '连接中...' : ghTest === 'fail' ? '连接失败' : '连接并保存'}
          </button>
        </div>
        <div className="data-hint">在 GitHub → Settings → Developer settings → Fine-grained tokens 生成，仅授予该仓库 Contents 读写。</div>
      </>
    )}
  </div>
)}
```
注意：`handleManualSync` 已 provider 无关（guard 用 getEffectiveProvider）。`applySyncResult` 为组件内既有函数。

- [ ] **Step 4: CSS**

`src/index.css` 加 `.github-panel`（参照已删的 onedrive-panel：间距/分隔），复用 `.webdav-field`/`.webdav-actions`/`.onedrive-account`/`.data-hint`。

- [ ] **Step 5: 校验**

`npx tsc --noEmit -p tsconfig.json` 无报错；`npm test` 35 绿；`npm run build` 成功。

- [ ] **Step 6: 提交**

```bash
git add src/components/SettingsModal.tsx src/index.css
git commit -m "feat: 设置面板增加 GitHub 选项与连接面板"
```

---

### Task 6: 端到端真机验证（人工 GUI）

**Files:** 无（验证）。

- [ ] **Step 1:** 启动应用 → 设置选 GitHub → 填 `simmzl/float-anchor-sync-test` + 一个 fine-grained PAT（或 classic repo token）→ 连接并保存 → 编辑卡片 → 观察自动同步成功、侧栏「已同步」。
- [ ] **Step 2:** 在 GitHub 网页确认 `float-anchor.json` 出现且有 commit 历史；改远端制造冲突 → 应弹冲突卡 → keep-local/use-remote 均正确。
- [ ] **Step 3:** 断网 → 失败 → 侧栏底部显示「GitHub 请求超限/网络连接失败」类精简原因。
- [ ] **Step 4:** 切回坚果云确认零回归。

---

## Self-Review（计划）

**Spec 覆盖：**
- §3 架构 / getActiveAdapter github → Task 3 ✅
- §4 GitHubAdapter 全方法 + sha 缓存/乐观并发 → Task 1 ✅
- §5 PAT 加密 + github-* IPC + 配置 → Task 2/3/4 ✅
- §6 错误展示 GitHub → Task 3 ✅
- §7 复用/provider 选择器 → Task 5 ✅
- §8 测试（fetch-mock + 真机仓库）→ Task 1/6 ✅

**占位符扫描：** Task 1 Step 5 真机用例为临时验证后移除（非交付占位）；其余无 TBD。

**类型一致性：** `createGitHubAdapter(config)`、`SyncProvider 'github'`、`settings.github={repo,branch?}`、github IPC 名在 Task 1/3/4/5 一致；`describeSyncError` 仅扩展不改签名。

**依赖顺序：** Task 1→2→3→4→5→6。Task 3 用 Task 1/2 导出；Task 5 用 Task 4 IPC + Task 3 后端。
