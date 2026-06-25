# OneDrive Provider + 常驻同步状态 实现计划（计划 2 / 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **前置：** 必须先完成《计划 1：Sync Provider 抽象 + 评审 Bug 修复》。本计划依赖其 `RemoteAdapter`/`LocalStore`/`reconcileState`/`getActiveAdapter`/`sync-*` IPC。

**Goal:** 新增 OneDrive 同步后端（Microsoft Graph + 设备码登录 + token 加密存储），设置里 provider 二选一，并在主界面侧栏常驻一个能感知「等待/同步中/成功/失败/待确认」的同步状态指示器。

**Architecture:** `OneDriveAdapter` 实现计划 1 的 `RemoteAdapter`（Graph REST，eTag 条件请求）。鉴权独立成 `onedrive-auth.ts`（设备码流 + refresh_token 经 `safeStorage` 加密落盘 + access_token 内存缓存与刷新）。`getActiveAdapter()` 增加 `'onedrive'` 分支。渲染层加 provider 选择器、OneDrive 面板、`pending` 状态、上传节流，以及侧栏 `SyncStatusIndicator`。

**Tech Stack:** Electron 28（主进程全局 `fetch` + `safeStorage`）、Microsoft Graph v1.0、TypeScript、React、zustand、vitest。

## Global Constraints

- 语言：所有面向用户文案用简体中文。
- token 安全：refresh_token 必须经 `safeStorage` 加密，存独立文件，**不**进 settings.json。
- 同时只启用一个 provider；切换不得双写。
- client_id 为公共客户端（无 secret），内嵌源码；未配置时 OneDrive 选项禁用并提示。
- 抗限流：遇 HTTP 429 读 `Retry-After` 退避；access_token 过期用 refresh_token 刷新，刷新失败标记断开。
- 提交粒度：每个 Task 末尾提交一次。
- 设计依据：`docs/superpowers/specs/2026-06-24-onedrive-sync-and-provider-abstraction-design.md`。

---

### Task 1: OneDrive 配置常量 + Azure 注册文档

**Files:**
- Create: `electron/sync/onedrive-config.ts`
- Create: `docs/onedrive-setup.md`

**Interfaces:**
- Produces: `ONEDRIVE_CLIENT_ID: string`、`ONEDRIVE_AUTHORITY`、`ONEDRIVE_SCOPES`、`isOneDriveConfigured(): boolean`、`GRAPH_BASE`。

- [ ] **Step 1: 写配置文件**

Create `electron/sync/onedrive-config.ts`:
```ts
// 公共客户端（device code flow），无 client secret，内嵌安全。
// 维护者需在 Entra/Azure 门户注册应用后，把 Application(client) ID 填到这里。
// 注册步骤见 docs/onedrive-setup.md。
export const ONEDRIVE_CLIENT_ID = '' // TODO(maintainer): 填入 Azure 应用的 client id

export const ONEDRIVE_AUTHORITY = 'https://login.microsoftonline.com/common'
export const ONEDRIVE_SCOPES = 'Files.ReadWrite.AppFolder offline_access User.Read'
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export function isOneDriveConfigured(): boolean {
  return ONEDRIVE_CLIENT_ID.trim().length > 0
}
```

> 说明：此处的 `TODO(maintainer)` 是**有意保留的手动填项**，非计划占位符——它是设计 §5.3 明确要求由维护者一次性手动完成的注册产物。

- [ ] **Step 2: 写注册文档**

Create `docs/onedrive-setup.md`，内容覆盖设计 §5.3 六步：进入 Entra/Azure 门户「应用注册」→ 受众选「任意组织 + 个人 Microsoft 账户」→「身份验证」开启 Allow public client flows →「API 权限」加 `Files.ReadWrite.AppFolder`+`offline_access`+`User.Read` → 复制 client id 填进 `onedrive-config.ts`。

- [ ] **Step 3: 提交**

```bash
git add electron/sync/onedrive-config.ts docs/onedrive-setup.md
git commit -m "feat: OneDrive 配置常量 + Azure 应用注册文档"
```

---

### Task 2: 设备码鉴权 + token 加密存储

**Files:**
- Create: `electron/sync/onedrive-auth.ts`

**Interfaces:**
- Consumes: Task 1 config。
- Produces:
  - `interface DeviceCodeInfo { userCode: string; verificationUri: string; message: string; expiresIn: number }`
  - `startDeviceLogin(onCode: (info: DeviceCodeInfo) => void): Promise<{ ok: true; account?: string } | { ok: false; error: string }>`
  - `cancelDeviceLogin(): void`
  - `getAccessToken(): Promise<string>`（过期自动刷新；无 token 抛错）
  - `isConnected(): boolean`
  - `disconnect(): void`
  - `loadAccount(): Promise<string | undefined>`（GET /me）

- [ ] **Step 1: 写 onedrive-auth.ts**

Create `electron/sync/onedrive-auth.ts`:
```ts
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { ONEDRIVE_AUTHORITY, ONEDRIVE_CLIENT_ID, ONEDRIVE_SCOPES, GRAPH_BASE } from './onedrive-config'

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
  expiresIn: number
}

let tokenFilePath = ''
export function initOneDriveAuth(filePath: string) { tokenFilePath = filePath }

let accessToken: string | null = null
let accessTokenExpiry = 0
let cancelled = false

function form(obj: Record<string, string>) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

function saveRefreshToken(rt: string) {
  if (!tokenFilePath) return
  try {
    if (!fs.existsSync(path.dirname(tokenFilePath))) fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true })
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(rt)
      : Buffer.from(rt, 'utf-8')
    fs.writeFileSync(tokenFilePath, enc)
  } catch (err) { console.error('saveRefreshToken failed:', err) }
}

function readRefreshToken(): string | null {
  try {
    if (!tokenFilePath || !fs.existsSync(tokenFilePath)) return null
    const buf = fs.readFileSync(tokenFilePath)
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch { return null }
}

export function isConnected(): boolean {
  return !!readRefreshToken()
}

export function disconnect() {
  accessToken = null
  accessTokenExpiry = 0
  try { if (tokenFilePath && fs.existsSync(tokenFilePath)) fs.unlinkSync(tokenFilePath) } catch {}
}

export function cancelDeviceLogin() { cancelled = true }

async function setTokensFromResponse(json: any) {
  accessToken = json.access_token
  accessTokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 // 提前 60s 过期
  if (json.refresh_token) saveRefreshToken(json.refresh_token)
}

export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiry) return accessToken
  const rt = readRefreshToken()
  if (!rt) throw new Error('OneDrive 未连接')
  const resp = await fetch(`${ONEDRIVE_AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: ONEDRIVE_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: rt,
      scope: ONEDRIVE_SCOPES,
    }),
  })
  const json = await resp.json()
  if (!resp.ok || !json.access_token) {
    disconnect()
    throw new Error('OneDrive 登录已失效，请重新连接')
  }
  await setTokensFromResponse(json)
  return accessToken!
}

export async function loadAccount(): Promise<string | undefined> {
  try {
    const token = await getAccessToken()
    const resp = await fetch(`${GRAPH_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (!resp.ok) return undefined
    const me = await resp.json()
    return me.userPrincipalName || me.mail || undefined
  } catch { return undefined }
}

export async function startDeviceLogin(onCode: (info: DeviceCodeInfo) => void): Promise<{ ok: true; account?: string } | { ok: false; error: string }> {
  cancelled = false
  const dcResp = await fetch(`${ONEDRIVE_AUTHORITY}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: ONEDRIVE_CLIENT_ID, scope: ONEDRIVE_SCOPES }),
  })
  const dc = await dcResp.json()
  if (!dcResp.ok || !dc.device_code) {
    return { ok: false, error: dc.error_description || '获取设备码失败' }
  }
  onCode({
    userCode: dc.user_code,
    verificationUri: dc.verification_uri,
    message: dc.message,
    expiresIn: dc.expires_in,
  })

  let interval = (dc.interval ?? 5) * 1000
  const deadline = Date.now() + (dc.expires_in ?? 900) * 1000
  while (Date.now() < deadline) {
    if (cancelled) return { ok: false, error: 'cancelled' }
    await new Promise((r) => setTimeout(r, interval))
    if (cancelled) return { ok: false, error: 'cancelled' }
    const tResp = await fetch(`${ONEDRIVE_AUTHORITY}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: ONEDRIVE_CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dc.device_code,
      }),
    })
    const tJson = await tResp.json()
    if (tResp.ok && tJson.access_token) {
      await setTokensFromResponse(tJson)
      const account = await loadAccount()
      return { ok: true, account }
    }
    if (tJson.error === 'authorization_pending') continue
    if (tJson.error === 'slow_down') { interval += 5000; continue }
    if (tJson.error === 'expired_token') return { ok: false, error: '授权码已过期，请重试' }
    if (tJson.error === 'access_denied') return { ok: false, error: '已取消授权' }
    return { ok: false, error: tJson.error_description || '登录失败' }
  }
  return { ok: false, error: '授权超时，请重试' }
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add electron/sync/onedrive-auth.ts
git commit -m "feat: OneDrive 设备码鉴权 + refresh_token 加密存储"
```

---

### Task 3: OneDriveAdapter（Graph REST + eTag）

**Files:**
- Create: `electron/sync/onedrive-adapter.ts`

**Interfaces:**
- Consumes: Task 1 config、Task 2 `getAccessToken`、计划 1 `RemoteAdapter`/`normalizeSyncData`。
- Produces: `createOneDriveAdapter(): RemoteAdapter`。

- [ ] **Step 1: 写 onedrive-adapter.ts**

Create `electron/sync/onedrive-adapter.ts`:
```ts
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
        body: buf,
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
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add electron/sync/onedrive-adapter.ts
git commit -m "feat: OneDriveAdapter（Graph REST + eTag + 429 退避）"
```

---

### Task 4: main.ts 接入 OneDrive（getActiveAdapter + 鉴权 IPC）

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: Task 2 auth、Task 3 adapter。
- Produces IPC：`onedrive-connect`、`onedrive-cancel-connect`、`onedrive-disconnect`、`onedrive-status`；事件 `onedrive-device-code`。

- [ ] **Step 1: main.ts import + 初始化 token 路径**

```ts
import { createOneDriveAdapter } from './sync/onedrive-adapter'
import { initOneDriveAuth, startDeviceLogin, cancelDeviceLogin, disconnect as onedriveDisconnect, isConnected as onedriveConnected, loadAccount } from './sync/onedrive-auth'
import { isOneDriveConfigured } from './sync/onedrive-config'
```
在 app `whenReady` 内（或 `getDataPaths` 后）加：
```ts
initOneDriveAuth(path.join(getDataPaths().dataDir, 'onedrive-token.bin'))
```

- [ ] **Step 2: getActiveAdapter 增加 onedrive 分支**

把计划 1 的 `getActiveAdapter` 改为：
```ts
function getActiveAdapter(): RemoteAdapter | null {
  const settings = readSettingsSync()
  const provider = settings?.syncProvider ?? (settings?.webdav?.server ? 'webdav' : 'none')
  if (provider === 'webdav' && settings?.webdav?.server) return createWebDAVAdapter(settings.webdav)
  if (provider === 'onedrive' && isOneDriveConfigured() && onedriveConnected()) return createOneDriveAdapter()
  return null
}
```

- [ ] **Step 3: 加 OneDrive 鉴权 IPC**

```ts
ipcMain.handle('onedrive-status', async () => {
  const configured = isOneDriveConfigured()
  const connected = configured && onedriveConnected()
  const account = connected ? await loadAccount() : undefined
  return { configured, connected, account }
})

ipcMain.handle('onedrive-connect', async () => {
  if (!isOneDriveConfigured()) return { success: false, error: '未配置 OneDrive Client ID' }
  const res = await startDeviceLogin((info) => {
    mainWindow?.webContents.send('onedrive-device-code', info)
  })
  return res.ok ? { success: true, account: res.account } : { success: false, error: res.error }
})

ipcMain.handle('onedrive-cancel-connect', async () => { cancelDeviceLogin(); return { success: true } })
ipcMain.handle('onedrive-disconnect', async () => { onedriveDisconnect(); return { success: true } })

ipcMain.handle('open-external', async (_e, url: string) => {
  // shell 已在 main.ts 顶部 import
  try { await shell.openExternal(url); return { success: true } } catch (err) { return { success: false, error: String(err) } }
})
```

- [ ] **Step 4: preload 暴露 OneDrive API**

`electron/preload.ts` 加：
```ts
  onedriveStatus: () => ipcRenderer.invoke('onedrive-status'),
  onedriveConnect: () => ipcRenderer.invoke('onedrive-connect'),
  onedriveCancelConnect: () => ipcRenderer.invoke('onedrive-cancel-connect'),
  onedriveDisconnect: () => ipcRenderer.invoke('onedrive-disconnect'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onOneDriveDeviceCode: (cb: (info: any) => void) => {
    const h = (_e: any, info: any) => cb(info)
    ipcRenderer.on('onedrive-device-code', h)
    return () => ipcRenderer.removeListener('onedrive-device-code', h)
  },
```

- [ ] **Step 5: types.ts 全局声明加 OneDrive**

`src/types.ts` 的 `window.electronAPI` 加：
```ts
      onedriveStatus: () => Promise<{ configured: boolean; connected: boolean; account?: string }>
      onedriveConnect: () => Promise<{ success: boolean; account?: string; error?: string }>
      onedriveCancelConnect: () => Promise<{ success: boolean }>
      onedriveDisconnect: () => Promise<{ success: boolean }>
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
      onOneDriveDeviceCode: (cb: (info: { userCode: string; verificationUri: string; message: string; expiresIn: number }) => void) => () => void
```

- [ ] **Step 6: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: 无报错。

- [ ] **Step 7: 提交**

```bash
git add electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat: main 接入 OneDrive provider + 设备码鉴权 IPC"
```

---

### Task 5: 设置面板 —— provider 选择器 + OneDrive 子面板

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/store.ts`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Task 4 OneDrive IPC、计划 1 `syncProvider` 设置。
- Produces: 设置里可选 `坚果云 / OneDrive / 关闭`；OneDrive 子面板含连接/设备码/断开。

- [ ] **Step 1: store 加 setSyncProvider action**

`src/store.ts` `AppState` 接口加 `setSyncProvider: (p: SyncProvider) => void`（从 `./types` import `SyncProvider`），实现：
```ts
  setSyncProvider: (p) => {
    const s = { ...get().settings, syncProvider: p }
    get().saveSettings(s)
  },
```

- [ ] **Step 2: SettingsModal 顶部加 provider 选择器**

把 `<h3>云同步 — 坚果云 (WebDAV)</h3>` 那个 section 的标题改为 `<h3>云同步</h3>`，紧随其后加一个三选一切换（复用 theme-switcher 样式类）：
```tsx
const syncProvider = settings.syncProvider ?? (settings.webdav?.server ? 'webdav' : 'none')
// ...
<div className="provider-switcher">
  <button className={`provider-option ${syncProvider === 'webdav' ? 'active' : ''}`} onClick={() => useStore.getState().setSyncProvider('webdav')}>坚果云 WebDAV</button>
  <button className={`provider-option ${syncProvider === 'onedrive' ? 'active' : ''}`} onClick={() => useStore.getState().setSyncProvider('onedrive')}>OneDrive</button>
  <button className={`provider-option ${syncProvider === 'none' ? 'active' : ''}`} onClick={() => useStore.getState().setSyncProvider('none')}>关闭</button>
</div>
```
把现有 WebDAV 表单包进 `{syncProvider === 'webdav' && ( ... )}`；同步状态点 + 冲突决策卡移到 provider 表单**之外**（两个 provider 共用），仅 `syncProvider !== 'none'` 时显示。

- [ ] **Step 3: 加 OneDrive 子面板**

在 provider 选择器下加 `{syncProvider === 'onedrive' && (<OneDrivePanel />)}`，新增内联组件/区块逻辑：
```tsx
const [odStatus, setOdStatus] = useState<{ configured: boolean; connected: boolean; account?: string }>({ configured: false, connected: false })
const [odDeviceCode, setOdDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null)
const [odConnecting, setOdConnecting] = useState(false)
const [odError, setOdError] = useState('')

useEffect(() => {
  window.electronAPI.onedriveStatus().then(setOdStatus)
  const unsub = window.electronAPI.onOneDriveDeviceCode((info) => {
    setOdDeviceCode({ userCode: info.userCode, verificationUri: info.verificationUri })
  })
  return unsub
}, [])

const handleConnectOneDrive = useCallback(async () => {
  setOdError(''); setOdConnecting(true); setOdDeviceCode(null)
  try {
    const res = await window.electronAPI.onedriveConnect()
    if (res.success) {
      setOdStatus({ configured: true, connected: true, account: res.account })
      useStore.getState().setSyncProvider('onedrive')
      useStore.getState().setSyncStatus('syncing')
      const sync = await window.electronAPI.syncAuto()
      await applySyncResult(sync)
    } else if (res.error !== 'cancelled') {
      setOdError(res.error || '连接失败')
    }
  } finally { setOdConnecting(false); setOdDeviceCode(null) }
}, [applySyncResult])

const handleDisconnectOneDrive = useCallback(async () => {
  await window.electronAPI.onedriveCancelConnect()
  await window.electronAPI.onedriveDisconnect()
  setOdStatus({ configured: true, connected: false })
  setOdDeviceCode(null)
}, [])
```
渲染：
```tsx
<div className="onedrive-panel">
  {!odStatus.configured ? (
    <div className="data-message error">OneDrive 尚未配置 Client ID，请参见 docs/onedrive-setup.md</div>
  ) : odStatus.connected ? (
    <>
      <div className="onedrive-account">已连接：{odStatus.account || 'OneDrive 账号'}</div>
      <div className="webdav-actions">
        <button onClick={handleManualSync} disabled={syncStatus === 'syncing' || !!syncDecision}>同步</button>
        <button onClick={handleDisconnectOneDrive}>断开</button>
      </div>
      <div className="data-hint">版本历史请到 OneDrive 网页端「版本历史」查看与还原。</div>
    </>
  ) : odDeviceCode ? (
    <div className="onedrive-devicecode">
      <p>打开 <b>{odDeviceCode.verificationUri}</b> 并输入代码：</p>
      <p className="device-code">{odDeviceCode.userCode}</p>
      <div className="webdav-actions">
        <button onClick={() => window.electronAPI.openExternal(odDeviceCode.verificationUri)}>打开授权页</button>
        <button onClick={handleDisconnectOneDrive}>取消</button>
      </div>
    </div>
  ) : (
    <div className="webdav-actions">
      <button className="primary" onClick={handleConnectOneDrive} disabled={odConnecting}>
        {odConnecting ? '等待授权...' : '连接 OneDrive'}
      </button>
    </div>
  )}
  {odError && <div className="data-message error">{odError}</div>}
</div>
```

- [ ] **Step 4: handleManualSync 兼容 OneDrive**

`handleManualSync` 内 `if (!cfg?.server) return` 改为 `if ((settings.syncProvider ?? 'none') === 'none') return`，其余调用 `syncStartup()` 不变（已 provider 无关）。

- [ ] **Step 5: CSS**

`src/index.css` 加 `.provider-switcher`/`.provider-option`（复用 theme-switcher 视觉）、`.onedrive-panel`、`.device-code`（大号等宽、可选中）、`.onedrive-account` 样式。

- [ ] **Step 6: 编译 + 构建**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 无报错；build 成功。

- [ ] **Step 7: 手动验证**

填入真实 client id 后：设置选 OneDrive → 连接 → 浏览器授权 → 回到应用显示账号 → 编辑卡片自动同步 → OneDrive 网页 `Apps/FloatAnchor/` 下出现 `float-anchor.json` 且有版本历史。

- [ ] **Step 8: 提交**

```bash
git add src/components/SettingsModal.tsx src/store.ts src/index.css
git commit -m "feat: 设置加 provider 选择器 + OneDrive 连接面板"
```

---

### Task 6: pending 状态 + 远端上传节流

**Files:**
- Modify: `src/types.ts`、`src/store.ts`

**Interfaces:**
- Consumes: 计划 1 `syncAuto`。
- Produces: `syncStatus` 联合类型加 `'pending'`；远端上传最小间隔合并。

- [ ] **Step 1: 扩展 syncStatus 类型**

`src/store.ts` 把 `syncStatus: 'idle' | 'syncing' | 'success' | 'error' | 'warning'` 全部出现处加 `'pending'`（接口字段 + `setSyncStatus` 参数类型，共 3 处）。`src/types.ts` 的 `SyncStatus.status` 同步加 `'pending'`（若存在该内部类型）。

- [ ] **Step 2: persist 里进入节流窗口置 pending + 最小上传间隔**

`src/store.ts` 顶部加 `let lastRemoteUploadAt = 0` 和 `const MIN_REMOTE_UPLOAD_INTERVAL_MS = 30000`。改 `persist()` 中触发同步那段：写入成功且 provider 启用时，先 `set({ syncStatus: 'pending' })`，再用 `syncTimer` 调度；调度回调里计算距上次上传是否够 `MIN_REMOTE_UPLOAD_INTERVAL_MS`，不够则把 timer 顺延到间隔到点；到点才 `set({ syncStatus: 'syncing' })` + `syncAuto()`，成功后 `lastRemoteUploadAt = Date.now()`。
```ts
if (settings.syncProvider && settings.syncProvider !== 'none' && !syncDecision) {
  set({ syncStatus: 'pending' })
  clearTimeout(syncTimer)
  const sinceLast = Date.now() - lastRemoteUploadAt
  const delay = Math.max(LOCAL_WEBDAV_SYNC_DELAY_MS, MIN_REMOTE_UPLOAD_INTERVAL_MS - sinceLast)
  syncTimer = setTimeout(() => {
    set({ syncStatus: 'syncing' })
    window.electronAPI.syncAuto().then(async (res) => {
      lastRemoteUploadAt = Date.now()
      // ...原有 res 处理逻辑不变...
    }).catch(() => set({ syncStatus: 'error' }))
  }, delay)
}
```

- [ ] **Step 3: 编译 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 无报错；测试 PASS。

- [ ] **Step 4: 提交**

```bash
git add src/types.ts src/store.ts
git commit -m "feat: 新增 pending 同步状态 + 远端上传节流"
```

---

### Task 7: 侧栏常驻 SyncStatusIndicator

**Files:**
- Create: `src/components/SyncStatusIndicator.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: store `syncStatus` / `settings.syncProvider` / `setShowSettings`。
- Produces: 侧栏顶部齿轮旁常驻指示器。

- [ ] **Step 1: 写组件**

Create `src/components/SyncStatusIndicator.tsx`:
```tsx
import { useStore } from '../store'

const META: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'connected', label: '已同步' },
  pending: { dot: 'pending', label: '待同步' },
  syncing: { dot: 'syncing', label: '同步中' },
  success: { dot: 'connected', label: '已同步' },
  error: { dot: 'error', label: '同步失败' },
  warning: { dot: 'warning', label: '待确认' },
}

export default function SyncStatusIndicator() {
  const syncStatus = useStore((s) => s.syncStatus)
  const provider = useStore((s) => s.settings.syncProvider ?? (s.settings.webdav?.server ? 'webdav' : 'none'))
  if (provider === 'none') return null

  const meta = META[syncStatus] ?? META.idle
  const clickable = syncStatus === 'error' || syncStatus === 'warning'
  return (
    <button
      className={`sync-indicator ${clickable ? 'clickable' : ''}`}
      title={`同步状态：${meta.label}`}
      onClick={clickable ? () => useStore.getState().setShowSettings(true) : undefined}
      disabled={!clickable}
    >
      <span className={`sync-dot ${meta.dot}`} />
      <span className="sync-indicator-label">{meta.label}</span>
    </button>
  )
}
```

- [ ] **Step 2: 接入侧栏顶部齿轮旁**

`src/components/Sidebar.tsx` 顶部 import `SyncStatusIndicator`，在 `sidebar-header`（约 172 行）里 `settings-gear` 按钮旁渲染 `<SyncStatusIndicator />`。

- [ ] **Step 3: CSS**

`src/index.css` 加 `.sync-indicator`（紧凑、无边框按钮）、`.sync-indicator-label`（小字、可省略）、`.sync-dot.pending`（琥珀 + 慢呼吸 keyframes）。复用现有 `.sync-dot.syncing/.error/.warning/.connected`。

- [ ] **Step 4: 编译 + 构建**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 无报错；build 成功。

- [ ] **Step 5: 手动验证状态流**

编辑卡片 → 侧栏出现「待同步」(pending) → 到点变「同步中」→「已同步」3s 后回 idle；断网编辑 → 「同步失败」红点常驻、可点开设置；制造冲突 → 「待确认」可点。

- [ ] **Step 6: 提交**

```bash
git add src/components/SyncStatusIndicator.tsx src/components/Sidebar.tsx src/index.css
git commit -m "feat: 侧栏常驻同步状态指示器"
```

---

## Self-Review（计划 2）

**Spec 覆盖：**
- §5.1 设备码鉴权 + token 加密刷新 → Task 2 ✅
- §5.2 AppFolder 路径 + eTag 条件请求 → Task 3 ✅
- §5.3 Azure 注册 + client id 占位 → Task 1 ✅
- §6 provider 选择器 + 迁移 → Task 5（+ 计划 1 已铺底）✅
- §8.1 OneDrive 子面板 + 共用状态/冲突卡 → Task 5 ✅
- §8.2 pending 状态 + SyncStatusIndicator + 侧栏接入 → Task 6/7 ✅
- §7 上传节流 → Task 6 ✅
- §9 错误处理（429 退避、刷新失败断开、device 错误分支）→ Task 2/3 ✅

**占位符扫描：** `ONEDRIVE_CLIENT_ID = ''` 是设计要求的维护者手动填项（Task 1 已注明），非计划缺口；其余无 TBD。

**类型一致性：** OneDrive IPC 名 `onedrive-status/-connect/-cancel-connect/-disconnect` 与事件 `onedrive-device-code` 在 Task 4 preload / Task 5 调用一致；`syncProvider` 取值 `webdav|onedrive|none` 全程一致；`syncStatus` 加 `pending` 在 Task 6 三处 + Task 7 META 一致。

**依赖顺序：** 必须在计划 1 完成后执行；Task 5 依赖 Task 4 的 IPC；Task 7 依赖 Task 6 的 `pending`。
```
