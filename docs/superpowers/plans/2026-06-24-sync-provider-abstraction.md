# Sync Provider 抽象 + 评审 Bug 修复 实现计划（计划 1 / 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把同步引擎从 WebDAV 写死重构为 provider 无关（`RemoteAdapter` + 注入式 `reconcileState`），并修复评审发现的 3 个问题，坚果云行为零回归。这是 OneDrive（计划 2）的基础。

**Architecture:** 新建 `electron/sync/` 目录，把远端操作抽成 `RemoteAdapter` 接口、本地 fs 操作抽成 `LocalStore` 接口、摘要/决策/图片名解析抽成纯函数模块。`reconcileState(adapter, store)` 接收注入依赖 → 可用内存 FakeAdapter + 临时目录 LocalStore 单测。`main.ts` 通过 `getActiveAdapter()` 依 `settings.syncProvider` 选 adapter，IPC 由 `webdav-*` 改为 provider 无关的 `sync-*`。

**Tech Stack:** Electron 28（Node 18，主进程有全局 `fetch`）、TypeScript、`webdav` npm 包（已依赖）、新增 `vitest` 做单测。

## Global Constraints

- 语言：所有面向用户文案用简体中文。
- 零回归：坚果云 WebDAV 的同步行为（上传/下载/冲突/高危/图片）实现后必须与当前一致。
- 测试：纯逻辑模块必须可在 vitest 下脱离 electron 运行（不在模块顶层 `import { app } from 'electron'`）。
- 本地优先：永不阻塞首屏；同步失败不得破坏本地数据。
- 提交粒度：每个 Task 末尾提交一次，message 用中文 `feat:/refactor:/fix:/test:` 前缀。
- 设计依据：`docs/superpowers/specs/2026-06-24-onedrive-sync-and-provider-abstraction-design.md`。

---

### Task 1: 引入 vitest 测试设施

**Files:**
- Modify: `package.json`（devDependencies + scripts）
- Create: `vitest.config.ts`
- Create: `electron/sync/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` 可运行 vitest；`electron/sync/__tests__/` 为测试目录约定。

- [ ] **Step 1: 安装 vitest**

Run:
```bash
npm install -D vitest@^2
```
Expected: `package.json` devDependencies 出现 `vitest`。

- [ ] **Step 2: 加 test 脚本**

`package.json` 的 `scripts` 加一行（放在 `"preview"` 之后）：
```json
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: 写 vitest 配置**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: 写冒烟测试**

Create `electron/sync/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest infra', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: 运行**

Run: `npm test`
Expected: PASS（1 个测试通过）。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json vitest.config.ts electron/sync/__tests__/smoke.test.ts
git commit -m "test: 引入 vitest 测试设施"
```

---

### Task 2: 抽出纯函数 —— 同步摘要与决策（行为不变）

把 `electron/main.ts` 中以下纯函数原样搬到新文件（暂不改行为），并补测试锁定现有行为，为 Task 3 修 bug 做准备。

**Files:**
- Create: `electron/sync/summary.ts`
- Create: `electron/sync/summary.test.ts`
- Modify: `electron/main.ts`（删除被搬走的函数，改为 import）

**Interfaces:**
- Produces:
  - `interface AppData { canvases: any[]; activeCanvasId: string | null; _syncTimestamp?: number; [k: string]: any }`
  - `interface SyncSummary { canvasCount; cardCount; labelCount; sectionCount; connectionCount; textCount; totalEntityCount: number }`
  - `type SyncResolution = 'keep-local' | 'use-remote'`
  - `type SyncReason = 'remote-newer' | 'diverged' | 'destructive-remote'`
  - `type SyncAction = 'uploaded' | 'downloaded' | 'up-to-date' | 'needs-confirmation'`
  - `interface SyncDecision { reason: SyncReason; risk: 'low'|'high'; message: string; preferredResolution: 'keep-local'; localSummary: SyncSummary; remoteSummary: SyncSummary; localTimestamp: number; remoteTimestamp: number }`
  - `normalizeSyncData(data, fallbackSyncTimestamp?) : AppData`
  - `summarizeSyncData(data): SyncSummary`
  - `hasMeaningfulSyncData(summary): boolean`
  - `getComparableSyncSnapshot(data): string`
  - `formatSyncSummary(summary): string`
  - `isHighRiskRemoteOverwrite(local, remote): boolean`
  - `buildSyncDecision(localData, remoteData, reason): SyncDecision`

- [ ] **Step 1: 写 summary.ts（含 textCount 字段，但计数逻辑先沿用现状以便 Task 3 用测试驱动）**

> 注意：本 Task 先把 `textCount` 字段加进类型，但**不**纳入 `totalEntityCount`/`hasMeaningfulSyncData`/`isHighRiskRemoteOverwrite`——保持与现状完全一致，由 Task 3 用红→绿测试把它接进去。

Create `electron/sync/summary.ts`:
```ts
export interface AppData {
  canvases: any[]
  activeCanvasId: string | null
  _syncTimestamp?: number
  [k: string]: any
}

export interface SyncSummary {
  canvasCount: number
  cardCount: number
  labelCount: number
  sectionCount: number
  connectionCount: number
  textCount: number
  totalEntityCount: number
}

export type SyncResolution = 'keep-local' | 'use-remote'
export type SyncReason = 'remote-newer' | 'diverged' | 'destructive-remote'
export type SyncAction = 'uploaded' | 'downloaded' | 'up-to-date' | 'needs-confirmation'

export interface SyncDecision {
  reason: SyncReason
  risk: 'low' | 'high'
  message: string
  preferredResolution: 'keep-local'
  localSummary: SyncSummary
  remoteSummary: SyncSummary
  localTimestamp: number
  remoteTimestamp: number
}

export function normalizeSyncData(data: any, fallbackSyncTimestamp = 0): AppData {
  return {
    ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}),
    canvases: Array.isArray(data?.canvases) ? data.canvases : [],
    activeCanvasId: data?.activeCanvasId ?? null,
    _syncTimestamp: typeof data?._syncTimestamp === 'number' ? data._syncTimestamp : fallbackSyncTimestamp,
  }
}

export function summarizeSyncData(data: any): SyncSummary {
  const normalized = normalizeSyncData(data)
  const canvases = normalized.canvases || []
  const cardCount = canvases.reduce((s: number, c: any) => s + (c.cards?.length || 0), 0)
  const labelCount = canvases.reduce((s: number, c: any) => s + (c.labels?.length || 0), 0)
  const sectionCount = canvases.reduce((s: number, c: any) => s + (c.sections?.length || 0), 0)
  const connectionCount = canvases.reduce((s: number, c: any) => s + (c.connections?.length || 0), 0)
  const textCount = canvases.reduce((s: number, c: any) => s + (c.texts?.length || 0), 0)
  return {
    canvasCount: canvases.length,
    cardCount,
    labelCount,
    sectionCount,
    connectionCount,
    textCount,
    // 注意：本 Task 暂不把 textCount 计入，Task 3 再改
    totalEntityCount: cardCount + labelCount + sectionCount + connectionCount,
  }
}

export function hasMeaningfulSyncData(summary: SyncSummary): boolean {
  return summary.totalEntityCount > 0 || summary.canvasCount > 1
}

export function getComparableSyncSnapshot(data: any): string {
  const normalized = normalizeSyncData(data)
  return JSON.stringify({
    canvases: normalized.canvases,
    activeCanvasId: normalized.activeCanvasId,
  })
}

export function formatSyncSummary(summary: SyncSummary): string {
  return `${summary.canvasCount} 个画布、${summary.cardCount} 张卡片、${summary.labelCount} 个标题、${summary.sectionCount} 个分区、${summary.connectionCount} 条连线`
}

export function isHighRiskRemoteOverwrite(localSummary: SyncSummary, remoteSummary: SyncSummary): boolean {
  if (!hasMeaningfulSyncData(localSummary)) return false
  if (!hasMeaningfulSyncData(remoteSummary)) return true
  if (localSummary.cardCount >= 10 && remoteSummary.cardCount === 0) return true
  const entityLoss = localSummary.totalEntityCount - remoteSummary.totalEntityCount
  return entityLoss >= 20 && remoteSummary.totalEntityCount <= Math.floor(localSummary.totalEntityCount * 0.7)
}

export function buildSyncDecision(localData: any, remoteData: any, reason: SyncReason): SyncDecision {
  const normalizedLocal = normalizeSyncData(localData)
  const normalizedRemote = normalizeSyncData(remoteData)
  const localSummary = summarizeSyncData(normalizedLocal)
  const remoteSummary = summarizeSyncData(normalizedRemote)
  const highRisk = reason === 'destructive-remote' || isHighRiskRemoteOverwrite(localSummary, remoteSummary)

  let message = `检测到云端与本地数据不同步，当前仍会优先保留本地显示。请确认是保留本地上传，还是使用云端覆盖本地。`
  if (reason === 'remote-newer' && !highRisk) {
    message = `检测到云端有更新，本地仍会优先显示。请确认是否使用云端数据更新本地内容。`
  }
  if (highRisk) {
    message = `云端数据会把本地数据从 ${formatSyncSummary(localSummary)} 变成 ${formatSyncSummary(remoteSummary)}。这是高危操作，请确认是否继续使用云端数据覆盖本地。`
  }

  return {
    reason: highRisk ? 'destructive-remote' : reason,
    risk: highRisk ? 'high' : 'low',
    message,
    preferredResolution: 'keep-local',
    localSummary,
    remoteSummary,
    localTimestamp: normalizedLocal._syncTimestamp || 0,
    remoteTimestamp: normalizedRemote._syncTimestamp || 0,
  }
}
```

- [ ] **Step 2: 写测试锁定现有行为**

Create `electron/sync/summary.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  summarizeSyncData, hasMeaningfulSyncData, isHighRiskRemoteOverwrite, buildSyncDecision,
} from './summary'

const canvas = (over: any = {}) => ({ id: 'c1', name: 'C', cards: [], ...over })

describe('summarizeSyncData', () => {
  it('counts cards/labels/sections/connections/texts', () => {
    const s = summarizeSyncData({ canvases: [canvas({
      cards: [{}, {}], labels: [{}], sections: [{}], connections: [{}], texts: [{}, {}, {}],
    })], activeCanvasId: 'c1' })
    expect(s.cardCount).toBe(2)
    expect(s.textCount).toBe(3)
  })
})

describe('hasMeaningfulSyncData (现状)', () => {
  it('单画布纯卡片为有意义', () => {
    expect(hasMeaningfulSyncData(summarizeSyncData({ canvases: [canvas({ cards: [{}] })], activeCanvasId: 'c1' }))).toBe(true)
  })
  it('空画布为无意义', () => {
    expect(hasMeaningfulSyncData(summarizeSyncData({ canvases: [canvas()], activeCanvasId: 'c1' }))).toBe(false)
  })
})

describe('isHighRiskRemoteOverwrite', () => {
  it('本地有数据、远端为空 → 高危', () => {
    const local = summarizeSyncData({ canvases: [canvas({ cards: [{}, {}] })] })
    const remote = summarizeSyncData({ canvases: [] })
    expect(isHighRiskRemoteOverwrite(local, remote)).toBe(true)
  })
})

describe('buildSyncDecision', () => {
  it('remote-newer 非高危给低危文案', () => {
    const local = { canvases: [canvas({ cards: [{}] })], _syncTimestamp: 1 }
    const remote = { canvases: [canvas({ cards: [{}, {}] })], _syncTimestamp: 2 }
    const d = buildSyncDecision(local, remote, 'remote-newer')
    expect(d.risk).toBe('low')
    expect(d.reason).toBe('remote-newer')
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: main.ts 改为 import，删除重复定义**

在 `electron/main.ts` 顶部 import 区加：
```ts
import {
  normalizeSyncData, summarizeSyncData, hasMeaningfulSyncData, getComparableSyncSnapshot,
  formatSyncSummary, isHighRiskRemoteOverwrite, buildSyncDecision,
} from './sync/summary'
import type { SyncSummary, SyncResolution } from './sync/summary'
```
删除 `electron/main.ts` 中这些函数/类型的原定义：`interface SyncSummary`（702-709）、`type SyncResolution`（711）、`normalizeSyncData`（713-720）、`summarizeSyncData`（722-737）、`hasMeaningfulSyncData`（739-741）、`getComparableSyncSnapshot`（743-749）、`formatSyncSummary`（751-753）、`isHighRiskRemoteOverwrite`（755-762）、`buildSyncDecision`（764-793）。

- [ ] **Step 5: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错（若 main.ts 仍有引用上述函数，import 已覆盖）。

- [ ] **Step 6: 提交**

```bash
git add electron/sync/summary.ts electron/sync/summary.test.ts electron/main.ts
git commit -m "refactor: 抽出同步摘要/决策为可测纯函数模块"
```

---

### Task 3: 修复 texts 同步保护盲区（TDD）

让「只有文本框」的画布被视为有意义数据，纳入高危覆盖保护。

**Files:**
- Modify: `electron/sync/summary.ts`
- Modify: `electron/sync/summary.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `summarizeSyncData` / `hasMeaningfulSyncData`。
- Produces: `totalEntityCount` 含 `textCount`；`formatSyncSummary` 末尾追加文本框数量。

- [ ] **Step 1: 写失败测试**

在 `electron/sync/summary.test.ts` 追加：
```ts
import { formatSyncSummary } from './summary'

describe('texts 纳入保护（Task 3）', () => {
  const canvas = (over: any = {}) => ({ id: 'c1', name: 'C', cards: [], ...over })

  it('只有文本框的单画布应为有意义数据', () => {
    const s = summarizeSyncData({ canvases: [canvas({ texts: [{}, {}] })], activeCanvasId: 'c1' })
    expect(hasMeaningfulSyncData(s)).toBe(true)
  })

  it('本地仅文本框、远端为空 → 高危覆盖', () => {
    const local = summarizeSyncData({ canvases: [canvas({ texts: [{}, {}, {}] })] })
    const remote = summarizeSyncData({ canvases: [] })
    expect(isHighRiskRemoteOverwrite(local, remote)).toBe(true)
  })

  it('formatSyncSummary 含文本框数量', () => {
    const s = summarizeSyncData({ canvases: [canvas({ texts: [{}] })] })
    expect(formatSyncSummary(s)).toContain('文本框')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（前两条因 totalEntityCount 不含 texts 而失败，第三条因文案无"文本框"失败）。

- [ ] **Step 3: 实现修复**

`electron/sync/summary.ts` 中 `summarizeSyncData` 的 return 改为：
```ts
    totalEntityCount: cardCount + labelCount + sectionCount + connectionCount + textCount,
```
`formatSyncSummary` 改为：
```ts
export function formatSyncSummary(summary: SyncSummary): string {
  return `${summary.canvasCount} 个画布、${summary.cardCount} 张卡片、${summary.labelCount} 个标题、${summary.sectionCount} 个分区、${summary.connectionCount} 条连线、${summary.textCount} 个文本框`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add electron/sync/summary.ts electron/sync/summary.test.ts
git commit -m "fix: texts 纳入同步摘要与高危覆盖保护"
```

---

### Task 4: 抽出图片名解析为纯函数（行为不变）

**Files:**
- Create: `electron/sync/image-names.ts`
- Create: `electron/sync/image-names.test.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Produces:
  - `IMAGE_EXTENSION_CANDIDATES: string[]`
  - `getImageBasename(value: string): string`
  - `extractStoredImageName(value: string): string | null`
  - `isRemoteImageNameMatch(requestedName: string, remoteName: string): boolean`
  - `getReferencedImageNames(data: any): Set<string>`

- [ ] **Step 1: 写 image-names.ts**

把 `electron/main.ts` 中 `IMAGE_EXTENSION_CANDIDATES`（490）、`getImageBasename`（523-526）、`extractStoredImageName`（528-555）、`isRemoteImageNameMatch`（657-662）、`getReferencedImageNames`（629-651）**原样**搬入新文件，顶部加 `import path from 'node:path'`，每个加 `export`。（这些只依赖 `node:path` + 字符串处理，可脱离 electron 测试。）

Create `electron/sync/image-names.ts`（内容为上述 5 项 + import，逐字搬运，不改逻辑）。

- [ ] **Step 2: 写测试**

Create `electron/sync/image-names.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { extractStoredImageName, getImageBasename, getReferencedImageNames, isRemoteImageNameMatch } from './image-names'

describe('getImageBasename', () => {
  it('去掉 query/hash 取文件名', () => {
    expect(getImageBasename('a/b/c.png?x=1#y')).toBe('c.png')
  })
})

describe('extractStoredImageName', () => {
  it('解析 fa-img:// 协议', () => {
    expect(extractStoredImageName('fa-img://abc.png')).toBe('abc.png')
  })
  it('非图片返回 null', () => {
    expect(extractStoredImageName('https://x.com/page')).toBeNull()
  })
})

describe('getReferencedImageNames', () => {
  it('扫描卡片正文里的 fa-img 引用', () => {
    const data = { canvases: [{ cards: [{ content: 'see fa-img://k.png here' }] }] }
    expect(getReferencedImageNames(data).has('k.png')).toBe(true)
  })
})

describe('isRemoteImageNameMatch', () => {
  it('同名匹配', () => {
    expect(isRemoteImageNameMatch('k.png', 'k.png')).toBe(true)
  })
})
```

- [ ] **Step 3: 运行**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: main.ts 改为 import 并删除原定义**

`electron/main.ts` import 区加：
```ts
import {
  IMAGE_EXTENSION_CANDIDATES, getImageBasename, extractStoredImageName,
  isRemoteImageNameMatch, getReferencedImageNames,
} from './sync/image-names'
```
删除 main.ts 中这 5 项的原定义。

- [ ] **Step 5: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add electron/sync/image-names.ts electron/sync/image-names.test.ts electron/main.ts
git commit -m "refactor: 抽出图片名解析为可测纯函数模块"
```

---

### Task 5: 定义 RemoteAdapter / LocalStore 接口

**Files:**
- Create: `electron/sync/types.ts`

**Interfaces:**
- Produces:
  - `interface RemoteImageEntry { name: string; size: number }`
  - `interface RemoteAdapter { test; loadRemoteSnapshot; uploadRemoteSnapshot; getRemoteTag?; listRemoteImages; uploadImage; downloadImage }`
  - `interface LocalImage { name: string; size: number }`
  - `interface LocalStore { readSnapshot; writeSnapshot; getModifiedAt; markSynced; backup; listImages; readImage; writeImage; getMissingImageNames; resolveStoredImagePath }`
  - `interface SyncResult { success; action?; data?; decision?; error? }`

- [ ] **Step 1: 写 types.ts**

Create `electron/sync/types.ts`:
```ts
import type { AppData, SyncAction, SyncDecision } from './summary'

export interface RemoteImageEntry { name: string; size: number }

export interface RemoteAdapter {
  test(): Promise<{ ok: boolean; error?: string }>
  loadRemoteSnapshot(): Promise<{ data: AppData; tag?: string } | null>
  uploadRemoteSnapshot(data: AppData, opts?: { ifMatch?: string }): Promise<{ tag?: string }>
  getRemoteTag?(): Promise<string | null>
  listRemoteImages(): Promise<RemoteImageEntry[]>
  uploadImage(name: string, buf: Buffer): Promise<void>
  downloadImage(name: string): Promise<Buffer>
}

export interface LocalImage { name: string; size: number }

export interface LocalStore {
  readSnapshot(): AppData | null
  writeSnapshot(data: AppData): void
  getModifiedAt(): number
  markSynced(syncTimestamp: number): void
  backup(): void
  listImages(): LocalImage[]
  readImage(name: string): Buffer | null
  writeImage(name: string, buf: Buffer): void
  getMissingImageNames(data: AppData): string[]
  resolveStoredImagePath(name: string): string | null
}

export interface SyncResult {
  success: boolean
  action?: SyncAction
  data?: AppData | null
  decision?: SyncDecision
  error?: string
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add electron/sync/types.ts
git commit -m "feat: 定义 RemoteAdapter / LocalStore / SyncResult 接口"
```

---

### Task 6: 实现 LocalStore（Node fs）

把现有本地 fs / 图片函数封进 `createNodeLocalStore(paths)`。

**Files:**
- Create: `electron/sync/local-store.ts`
- Create: `electron/sync/local-store.test.ts`

**Interfaces:**
- Consumes: Task 4 `image-names`、Task 5 `LocalStore`、Task 2 `normalizeSyncData`。
- Produces: `createNodeLocalStore(opts: { dataFile: string; imagesDir: string; backupDir: string; maxBackups?: number }): LocalStore`、`isRealImageFile(filePath: string): boolean`。

- [ ] **Step 1: 写 local-store.ts**

Create `electron/sync/local-store.ts`:
```ts
import fs from 'node:fs'
import path from 'node:path'
import type { AppData } from './summary'
import { normalizeSyncData } from './summary'
import type { LocalStore, LocalImage } from './types'
import { IMAGE_EXTENSION_CANDIDATES, extractStoredImageName, getImageBasename, getReferencedImageNames } from './image-names'

export function isRealImageFile(filePath: string): boolean {
  try {
    const header = fs.readFileSync(filePath).subarray(0, 12)
    return (
      header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      header.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ||
      header.subarray(0, 4).toString('ascii') === 'GIF8' ||
      (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') ||
      header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
    )
  } catch {
    return false
  }
}

export function createNodeLocalStore(opts: {
  dataFile: string
  imagesDir: string
  backupDir: string
  maxBackups?: number
}): LocalStore {
  const { dataFile, imagesDir, backupDir } = opts
  const maxBackups = opts.maxBackups ?? 5

  function resolveStoredImagePath(fileName: string): string | null {
    const normalizedName = path.basename(fileName)
    const exactPath = path.join(imagesDir, normalizedName)
    if (fs.existsSync(exactPath) && isRealImageFile(exactPath)) return exactPath
    const baseName = path.parse(normalizedName).name || normalizedName
    for (const ext of IMAGE_EXTENSION_CANDIDATES) {
      const candidate = path.join(imagesDir, `${baseName}${ext}`)
      if (fs.existsSync(candidate) && isRealImageFile(candidate)) return candidate
    }
    return null
  }

  return {
    readSnapshot(): AppData | null {
      try {
        if (!fs.existsSync(dataFile)) return null
        return normalizeSyncData(JSON.parse(fs.readFileSync(dataFile, 'utf-8')))
      } catch {
        return null
      }
    },
    writeSnapshot(data: AppData) {
      if (!fs.existsSync(path.dirname(dataFile))) fs.mkdirSync(path.dirname(dataFile), { recursive: true })
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8')
    },
    getModifiedAt(): number {
      try {
        if (!fs.existsSync(dataFile)) return 0
        return fs.statSync(dataFile).mtimeMs
      } catch {
        return 0
      }
    },
    markSynced(syncTimestamp: number) {
      if (!syncTimestamp || !fs.existsSync(dataFile)) return
      try {
        const t = new Date(syncTimestamp)
        fs.utimesSync(dataFile, t, t)
      } catch {}
    },
    backup() {
      try {
        if (!fs.existsSync(dataFile)) return
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(dataFile, path.join(backupDir, `backup-${ts}.json`))
        const files = fs.readdirSync(backupDir).sort()
        while (files.length > maxBackups) fs.unlinkSync(path.join(backupDir, files.shift()!))
      } catch (err) {
        console.error('Backup failed:', err)
      }
    },
    listImages(): LocalImage[] {
      if (!fs.existsSync(imagesDir)) return []
      return fs.readdirSync(imagesDir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => ({ name: e.name, size: fs.statSync(path.join(imagesDir, e.name)).size }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    readImage(name: string): Buffer | null {
      const p = path.join(imagesDir, path.basename(name))
      return fs.existsSync(p) ? fs.readFileSync(p) : null
    },
    writeImage(name: string, buf: Buffer) {
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
      fs.writeFileSync(path.join(imagesDir, path.basename(name)), buf)
    },
    getMissingImageNames(data: AppData): string[] {
      return Array.from(getReferencedImageNames(data)).filter((n) => !resolveStoredImagePath(n))
    },
    resolveStoredImagePath,
  }
}
```

- [ ] **Step 2: 写测试（用临时目录）**

Create `electron/sync/local-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNodeLocalStore } from './local-store'

let dir: string
let store: ReturnType<typeof createNodeLocalStore>

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-ls-'))
  store = createNodeLocalStore({
    dataFile: path.join(dir, 'float-anchor.json'),
    imagesDir: path.join(dir, 'images'),
    backupDir: path.join(dir, 'backups'),
    maxBackups: 2,
  })
})
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('LocalStore 读写', () => {
  it('写入后能读回并归一化', () => {
    store.writeSnapshot({ canvases: [{ id: 'c1', cards: [] }], activeCanvasId: 'c1', _syncTimestamp: 9 })
    const back = store.readSnapshot()
    expect(back?._syncTimestamp).toBe(9)
    expect(back?.canvases.length).toBe(1)
  })
  it('无文件时 readSnapshot 返回 null', () => {
    expect(store.readSnapshot()).toBeNull()
  })
})

describe('LocalStore 备份保留上限', () => {
  it('超过 maxBackups 时清理最旧', () => {
    store.writeSnapshot({ canvases: [], activeCanvasId: null })
    store.backup(); store.backup(); store.backup()
    const files = fs.readdirSync(path.join(dir, 'backups'))
    expect(files.length).toBeLessThanOrEqual(2)
  })
})

describe('LocalStore 图片', () => {
  it('写入图片后能列出含大小', () => {
    store.writeImage('a.png', Buffer.from([1, 2, 3]))
    const list = store.listImages()
    expect(list).toEqual([{ name: 'a.png', size: 3 }])
  })
})
```

- [ ] **Step 3: 运行**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add electron/sync/local-store.ts electron/sync/local-store.test.ts
git commit -m "feat: 实现 Node fs 版 LocalStore + 单测"
```

---

### Task 7: 实现 reconcile 引擎（注入 adapter + store）

把 `reconcileWebDAVState` / `resolveWebDAVConflict` 的决策逻辑搬进 provider 无关引擎，并在此实现**图片差异上传**。

**Files:**
- Create: `electron/sync/engine.ts`
- Create: `electron/sync/engine.test.ts`

**Interfaces:**
- Consumes: Task 2 `summary`、Task 5 `types`、Task 6 `LocalStore`。
- Produces:
  - `reconcileState(adapter: RemoteAdapter, store: LocalStore): Promise<SyncResult>`
  - `resolveConflict(adapter: RemoteAdapter, store: LocalStore, resolution: SyncResolution): Promise<SyncResult>`

- [ ] **Step 1: 写 engine.ts**

Create `electron/sync/engine.ts`:
```ts
import type { AppData, SyncResolution } from './summary'
import {
  normalizeSyncData, summarizeSyncData, hasMeaningfulSyncData, getComparableSyncSnapshot,
  isHighRiskRemoteOverwrite, buildSyncDecision,
} from './summary'
import type { RemoteAdapter, LocalStore, SyncResult } from './types'

const LOCAL_SYNC_DIRTY_TOLERANCE_MS = 1500

async function uploadImagesDiff(adapter: RemoteAdapter, store: LocalStore) {
  const local = store.listImages()
  if (local.length === 0) return
  const remote = await adapter.listRemoteImages()
  const remoteByName = new Map(remote.map((r) => [r.name, r.size]))
  for (const img of local) {
    const remoteSize = remoteByName.get(img.name)
    if (remoteSize === img.size) continue // 同名同大小，跳过
    const buf = store.readImage(img.name)
    if (buf) await adapter.uploadImage(img.name, buf)
  }
}

async function downloadMissingImages(adapter: RemoteAdapter, store: LocalStore, data: AppData): Promise<number> {
  const missing = store.getMissingImageNames(data)
  if (missing.length === 0) return 0
  const remote = await adapter.listRemoteImages()
  if (remote.length === 0) return 0
  let n = 0
  for (const name of missing) {
    const base = name.split(/[?#]/)[0].replace(/\\/g, '/').split('/').pop() || name
    const entry = remote.find((r) => r.name === base || r.name === name)
    if (!entry) continue
    const buf = await adapter.downloadImage(entry.name)
    store.writeImage(entry.name, buf)
    n += 1
  }
  return n
}

async function uploadSnapshot(adapter: RemoteAdapter, store: LocalStore): Promise<AppData> {
  const local = store.readSnapshot()
  const data = normalizeSyncData(local, Date.now())
  data._syncTimestamp = Date.now()
  await uploadImagesDiff(adapter, store)
  await adapter.uploadRemoteSnapshot(data)
  store.writeSnapshot(data)
  store.markSynced(data._syncTimestamp)
  return data
}

async function applyRemote(adapter: RemoteAdapter, store: LocalStore, remoteData: any): Promise<AppData> {
  const normalized = normalizeSyncData(remoteData, Date.now())
  store.backup()
  store.writeSnapshot(normalized)
  store.markSynced(normalized._syncTimestamp || 0)
  await downloadMissingImages(adapter, store, normalized)
  return normalized
}

export async function reconcileState(adapter: RemoteAdapter, store: LocalStore): Promise<SyncResult> {
  const localData = store.readSnapshot()
  const localTs = localData?._syncTimestamp || 0
  const localSummary = summarizeSyncData(localData)
  const localFingerprint = localData ? getComparableSyncSnapshot(localData) : ''
  const localModifiedAt = store.getModifiedAt()
  const localDirty = !!localData && localModifiedAt > localTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS

  const remote = await adapter.loadRemoteSnapshot()
  if (!remote) {
    if (localData && hasMeaningfulSyncData(localSummary)) {
      await uploadSnapshot(adapter, store)
      return { success: true, action: 'uploaded' }
    }
    return { success: true, action: 'up-to-date' }
  }

  const remoteData = remote.data
  const remoteTs = remoteData._syncTimestamp || 0
  const remoteSummary = summarizeSyncData(remoteData)
  const remoteFingerprint = getComparableSyncSnapshot(remoteData)
  const localMissingDownloaded = localData ? await downloadMissingImages(adapter, store, localData) : 0

  if (!localData) {
    if (hasMeaningfulSyncData(remoteSummary)) {
      const applied = await applyRemote(adapter, store, remoteData)
      return { success: true, action: 'downloaded', data: applied }
    }
    return { success: true, action: 'up-to-date' }
  }

  if (localFingerprint === remoteFingerprint) {
    if (localMissingDownloaded > 0) return { success: true, action: 'downloaded', data: localData }
    return { success: true, action: 'up-to-date' }
  }

  if (localDirty) {
    if (remoteTs > localTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS) {
      return { success: true, action: 'needs-confirmation', decision: buildSyncDecision(localData, remoteData, 'diverged') }
    }
    await uploadSnapshot(adapter, store)
    return { success: true, action: 'uploaded' }
  }

  if (localTs > remoteTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS) {
    await uploadSnapshot(adapter, store)
    return { success: true, action: 'uploaded' }
  }

  if (remoteTs > localTs + LOCAL_SYNC_DIRTY_TOLERANCE_MS) {
    if (!hasMeaningfulSyncData(localSummary) && hasMeaningfulSyncData(remoteSummary)) {
      const applied = await applyRemote(adapter, store, remoteData)
      return { success: true, action: 'downloaded', data: applied }
    }
    return {
      success: true,
      action: 'needs-confirmation',
      decision: buildSyncDecision(localData, remoteData, isHighRiskRemoteOverwrite(localSummary, remoteSummary) ? 'destructive-remote' : 'remote-newer'),
    }
  }

  if (!hasMeaningfulSyncData(localSummary) && hasMeaningfulSyncData(remoteSummary)) {
    const applied = await applyRemote(adapter, store, remoteData)
    return { success: true, action: 'downloaded', data: applied }
  }

  if (hasMeaningfulSyncData(localSummary) && !hasMeaningfulSyncData(remoteSummary)) {
    await uploadSnapshot(adapter, store)
    return { success: true, action: 'uploaded' }
  }

  return {
    success: true,
    action: 'needs-confirmation',
    decision: buildSyncDecision(localData, remoteData, isHighRiskRemoteOverwrite(localSummary, remoteSummary) ? 'destructive-remote' : 'diverged'),
  }
}

export async function resolveConflict(adapter: RemoteAdapter, store: LocalStore, resolution: SyncResolution): Promise<SyncResult> {
  if (resolution === 'keep-local') {
    if (!store.readSnapshot()) return { success: false, error: '没有找到本地数据文件' }
    const uploaded = await uploadSnapshot(adapter, store)
    return { success: true, action: 'uploaded', data: uploaded }
  }
  const remote = await adapter.loadRemoteSnapshot()
  if (!remote) return { success: false, error: '云端没有可用数据' }
  const applied = await applyRemote(adapter, store, remote.data)
  return { success: true, action: 'downloaded', data: applied }
}
```

> 与原 `reconcileWebDAVState` 的差异：(a) 远端/本地操作走注入接口；(b) `localTs > remoteTs` 分支去掉了原 `hasLocalFile` 判断（`readSnapshot()` 非空即等价）；(c) 上传走差异上传。决策树顺序与原实现一致以保证零回归。

- [ ] **Step 2: 写引擎测试（FakeAdapter + 内存 store）**

Create `electron/sync/engine.test.ts`:
```ts
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
    const remote = { ...canvasWith({ cards: [{}, {}] }), _syncTimestamp: 10 }
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
```

- [ ] **Step 3: 运行**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add electron/sync/engine.ts electron/sync/engine.test.ts
git commit -m "feat: provider 无关 reconcile 引擎 + 图片差异上传 + 单测"
```

---

### Task 8: 实现 WebDAVAdapter

**Files:**
- Create: `electron/sync/webdav-adapter.ts`

**Interfaces:**
- Consumes: Task 2 `normalizeSyncData`、Task 5 `RemoteAdapter`、`webdav` 包。
- Produces: `createWebDAVAdapter(config: { server: string; username: string; password: string }): RemoteAdapter`、常量 `WEBDAV_REMOTE_FILE` / `WEBDAV_REMOTE_DIR` / `WEBDAV_REMOTE_IMAGES_DIR`。

- [ ] **Step 1: 写 webdav-adapter.ts**

Create `electron/sync/webdav-adapter.ts`:
```ts
import path from 'node:path'
import { normalizeSyncData } from './summary'
import type { AppData } from './summary'
import type { RemoteAdapter, RemoteImageEntry } from './types'

export const WEBDAV_REMOTE_DIR = 'FloatAnchor'
export const WEBDAV_REMOTE_FILE = 'FloatAnchor/float-anchor.json'
export const WEBDAV_REMOTE_IMAGES_DIR = 'FloatAnchor/images'

function toBinaryBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array) return Buffer.from(content)
  if (content instanceof ArrayBuffer) return Buffer.from(content)
  if (typeof content === 'string') return Buffer.from(content, 'binary')
  return Buffer.from([])
}

async function ensureDir(client: any, dir: string) {
  try {
    if (!(await client.exists(dir))) await client.createDirectory(dir)
  } catch (err) {
    console.log(`ensureDir note for ${dir}:`, err)
  }
}

export function createWebDAVAdapter(config: { server: string; username: string; password: string }): RemoteAdapter {
  let clientPromise: Promise<any> | null = null
  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = import('webdav').then(({ createClient }) =>
        createClient(config.server, { username: config.username, password: config.password }))
    }
    return clientPromise
  }

  return {
    async test() {
      try {
        const client = await getClient()
        await client.getDirectoryContents('/')
        await ensureDir(client, WEBDAV_REMOTE_DIR)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
    async loadRemoteSnapshot(): Promise<{ data: AppData; tag?: string } | null> {
      const client = await getClient()
      if (!(await client.exists(WEBDAV_REMOTE_FILE))) return null
      const raw = await client.getFileContents(WEBDAV_REMOTE_FILE, { format: 'text' })
      return { data: normalizeSyncData(JSON.parse(raw as string)) }
    },
    async uploadRemoteSnapshot(data: AppData) {
      const client = await getClient()
      await ensureDir(client, WEBDAV_REMOTE_DIR)
      await client.putFileContents(WEBDAV_REMOTE_FILE, JSON.stringify(data, null, 2), { overwrite: true })
      return {}
    },
    async getRemoteTag() {
      return null // WebDAV 退回 _syncTimestamp 逻辑
    },
    async listRemoteImages(): Promise<RemoteImageEntry[]> {
      const client = await getClient()
      if (!(await client.exists(WEBDAV_REMOTE_IMAGES_DIR))) return []
      const entries = await client.getDirectoryContents(WEBDAV_REMOTE_IMAGES_DIR)
      return (Array.isArray(entries) ? entries : [entries])
        .filter((e: any) => e?.type === 'file')
        .map((e: any) => ({ name: e.basename || path.posix.basename(e.filename || ''), size: e.size || 0 }))
    },
    async uploadImage(name: string, buf: Buffer) {
      const client = await getClient()
      await ensureDir(client, WEBDAV_REMOTE_IMAGES_DIR)
      await client.putFileContents(`${WEBDAV_REMOTE_IMAGES_DIR}/${name}`, buf, { overwrite: true })
    },
    async downloadImage(name: string): Promise<Buffer> {
      const client = await getClient()
      const binary = await client.getFileContents(`${WEBDAV_REMOTE_IMAGES_DIR}/${name}`, { format: 'binary' })
      return toBinaryBuffer(binary)
    },
  }
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add electron/sync/webdav-adapter.ts
git commit -m "feat: 实现 WebDAVAdapter（包装现有 webdav 逻辑）"
```

---

### Task 9: main.ts 接入引擎 + provider 无关 IPC

把 main.ts 里旧的 WebDAV 同步实现替换为「getActiveAdapter + 引擎」，IPC 由 `webdav-*` 改为 `sync-*`。

**Files:**
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: Task 6 `createNodeLocalStore`、Task 7 `reconcileState`/`resolveConflict`、Task 8 `createWebDAVAdapter`。
- Produces 新 IPC：`sync-test`(config)、`sync-auto`、`sync-startup`、`sync-periodic`、`sync-resolve-conflict`(resolution)、`sync-get-remote-changed`。

- [ ] **Step 1: 在 main.ts 顶部 import 新模块**

```ts
import { createNodeLocalStore } from './sync/local-store'
import { reconcileState, resolveConflict } from './sync/engine'
import { createWebDAVAdapter } from './sync/webdav-adapter'
import type { RemoteAdapter, LocalStore } from './sync/types'
import type { AppSettings } from '../src/types'
```

- [ ] **Step 2: 加 getLocalStore / getActiveAdapter 工具函数**

在 main.ts 的 `/* ===== WebDAV Sync ===== */` 区附近加：
```ts
function getLocalStore(): LocalStore {
  const { dataDir: dir, dataFile: file } = getDataPaths()
  return createNodeLocalStore({
    dataFile: file,
    imagesDir: path.join(dir, 'images'),
    backupDir: path.join(dir, 'backups'),
    maxBackups: 5,
  })
}

function readSettingsSync(): AppSettings | null {
  try {
    const { settingsFile: f } = getDataPaths()
    if (!fs.existsSync(f)) return null
    return JSON.parse(fs.readFileSync(f, 'utf-8'))
  } catch {
    return null
  }
}

function getActiveAdapter(): RemoteAdapter | null {
  const settings = readSettingsSync()
  const provider = settings?.syncProvider
    ?? (settings?.webdav?.server ? 'webdav' : 'none')
  if (provider === 'webdav' && settings?.webdav?.server) {
    return createWebDAVAdapter(settings.webdav)
  }
  // 'onedrive' 在计划 2 接入
  return null
}
```

- [ ] **Step 3: 删除旧 WebDAV 实现，替换 IPC**

删除 main.ts 中以下已被模块替代的代码块：`createBackup`（460-475）、`getWebDAVClient`（477-483）、`getImagesDir`（485-488）、`isRealImageFile`（492-506）、`resolveStoredImagePath`（508-521）、`ensureRemoteDirectory`/`ensureRemoteDir`（557-570）、`listLocalImageFiles`（572-578）、`toBinaryBuffer`（580-586）、`uploadLocalImages`（588-599）、`getRemoteImageFiles`（601-607）、`downloadRemoteImages`（609-627）、`getMissingLocalImageNames`（653-655）、`downloadMissingRemoteImagesForData`（664-696）、`getCardCount`（698-700）、`getLocalFileModifiedAt`（795-802）、`markLocalSnapshotSynced`（804-812）、`hasMissingLocalImages`（814-816）、`uploadLocalSnapshot`（818-830）、`loadRemoteSnapshot`（832-836）、`applyRemoteSnapshot`（838-845）、`reconcileWebDAVState`（847-950）、`resolveWebDAVConflict`（952-975），以及常量 `WEBDAV_REMOTE_FILE`/`WEBDAV_REMOTE_IMAGES_DIR`/`MAX_BACKUPS`/`WEBDAV_REMOTE_DIR`（保留 `LOCAL_SYNC_DIRTY_TOLERANCE_MS` 已移入引擎，删本处）。保留 `enqueueWebDAVSync` 队列（改名 `enqueueSync`）。

替换 IPC handlers（删除 `webdav-test`/`webdav-upload`/`webdav-download`/`webdav-auto-sync`/`webdav-startup-sync`/`webdav-periodic-sync`/`webdav-resolve-conflict`），新增：
```ts
let syncQueue: Promise<void> = Promise.resolve()
function enqueueSync<T>(task: () => Promise<T>): Promise<T> {
  const next = syncQueue.then(task, task)
  syncQueue = next.then(() => undefined, () => undefined)
  return next
}

ipcMain.handle('sync-test', async (_e, config: { server: string; username: string; password: string }) => {
  // 计划 1 仅 WebDAV：直接测 webdav config
  const adapter = createWebDAVAdapter(config)
  const r = await adapter.test()
  return r.ok ? { success: true } : { success: false, error: r.error }
})

async function runSync() {
  const adapter = getActiveAdapter()
  if (!adapter) return { success: false, error: '未配置同步' }
  return reconcileState(adapter, getLocalStore())
}

ipcMain.handle('sync-auto', async () => enqueueSync(async () => {
  try {
    const result = await runSync()
    if (result.success && result.action === 'needs-confirmation') {
      mainWindow?.webContents.send('sync-status', { status: 'warning' })
    } else if (result.success) {
      mainWindow?.webContents.send('sync-status', { status: 'success' })
    } else {
      mainWindow?.webContents.send('sync-status', { status: 'error', error: result.error })
    }
    return result
  } catch (err) {
    mainWindow?.webContents.send('sync-status', { status: 'error', error: String(err) })
    return { success: false, error: String(err) }
  }
}))

ipcMain.handle('sync-startup', async () => enqueueSync(async () => {
  try { return await runSync() } catch (err) { return { success: false, error: String(err) } }
}))

ipcMain.handle('sync-periodic', async () => enqueueSync(async () => {
  try { return await runSync() } catch (err) { return { success: false, error: String(err) } }
}))

ipcMain.handle('sync-resolve-conflict', async (_e, resolution: 'keep-local' | 'use-remote') => enqueueSync(async () => {
  try {
    const adapter = getActiveAdapter()
    if (!adapter) return { success: false, error: '未配置同步' }
    const result = await resolveConflict(adapter, getLocalStore(), resolution)
    if (result.success) mainWindow?.webContents.send('sync-status', { status: 'success' })
    return result
  } catch (err) {
    mainWindow?.webContents.send('sync-status', { status: 'error', error: String(err) })
    return { success: false, error: String(err) }
  }
}))
```

> 注：原 `webdav-upload`/`webdav-download` 仅被 renderer 间接使用，确认无渲染层引用后删除（Task 10 一并清理 preload）。

- [ ] **Step 4: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错（renderer 仍引用旧 API 的报错在 Task 10 修复；本步只确保 main.ts 自身通过——若有跨文件报错，记下待 Task 10）。

- [ ] **Step 5: 提交**

```bash
git add electron/main.ts
git commit -m "refactor: main.ts 接入 provider 无关同步引擎 + sync-* IPC"
```

---

### Task 10: 更新 preload + 渲染层调用新 IPC

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/types.ts`（`window.electronAPI` 声明 + `AppSettings` 加 `syncProvider`/`onedrive`）
- Modify: `src/store.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: Task 9 的 `sync-*` IPC。
- Produces: `window.electronAPI.syncTest/syncAuto/syncStartup/syncPeriodic/syncResolveConflict`。

- [ ] **Step 1: preload 暴露新 API，删旧的**

`electron/preload.ts` 中把 `webdavTest/webdavUpload/webdavDownload/webdavAutoSync/webdavStartupSync/webdavPeriodicSync/webdavResolveConflict` 七项替换为：
```ts
  syncTest: (config: any) => ipcRenderer.invoke('sync-test', config),
  syncAuto: () => ipcRenderer.invoke('sync-auto'),
  syncStartup: () => ipcRenderer.invoke('sync-startup'),
  syncPeriodic: () => ipcRenderer.invoke('sync-periodic'),
  syncResolveConflict: (resolution: 'keep-local' | 'use-remote') =>
    ipcRenderer.invoke('sync-resolve-conflict', resolution),
```
（`onSyncStatus` 保留不变。）

- [ ] **Step 2: types.ts 更新全局声明 + 设置类型**

`src/types.ts`：
- `AppSettings` 改为：
```ts
export type SyncProvider = 'webdav' | 'onedrive' | 'none'

export interface AppSettings {
  theme: 'light' | 'dark'
  webdav?: WebDAVConfig
  syncProvider?: SyncProvider
  onedrive?: { connected: boolean; account?: string }
}
```
- `WebDAVSyncSummary` 增加 `textCount: number`。
- `window.electronAPI` 接口里删除 7 个 `webdav*` 方法声明，替换为：
```ts
      syncTest: (config: WebDAVConfig) => Promise<{ success: boolean; error?: string }>
      syncAuto: () => Promise<WebDAVSyncResult>
      syncStartup: () => Promise<WebDAVSyncResult>
      syncPeriodic: () => Promise<WebDAVSyncResult>
      syncResolveConflict: (resolution: WebDAVSyncResolution) => Promise<WebDAVSyncResult>
```

- [ ] **Step 3: store.ts persist 改调 syncAuto（去掉 config 参数）**

`src/store.ts` `persist()` 内把 `window.electronAPI.webdavAutoSync(settings.webdav!)` 改为
`window.electronAPI.syncAuto()`；判断条件 `settings.webdav?.server` 改为
`settings.syncProvider && settings.syncProvider !== 'none'`。其余分支逻辑不变。

- [ ] **Step 4: App.tsx 改调 syncStartup/syncPeriodic**

`src/App.tsx`：
- `webdavStartupSync(settings.webdav)` → `syncStartup()`；触发条件 `settings.webdav?.server`
  → `settings.syncProvider && settings.syncProvider !== 'none'`。
- `webdavPeriodicSync(config)` → `syncPeriodic()`；`runBackgroundSync(config)` 改为无参
  `runBackgroundSync()`，并把 effect 依赖里的 `webdavConfig` 改为
  `useStore((s) => s.settings.syncProvider)`。

- [ ] **Step 5: SettingsModal.tsx 改调 syncTest/syncAuto/syncStartup/syncResolveConflict + formatSyncSummary 加文本框**

`src/components/SettingsModal.tsx`：
- `webdavTest(config)` → `syncTest(config)`（共 2 处：handleTest、handleSave）。
- `webdavAutoSync(config)` → `syncAuto()`（handleSave）。
- `webdavStartupSync(cfg)` → `syncStartup()`（handleManualSync；其前的 `writeData` 保留）。
- `webdavResolveConflict(cfg, resolution)` → `syncResolveConflict(resolution)`（handleResolveSync）。
- `formatSyncSummary` 文案末尾加 `/ ${summary.textCount} 个文本框`。
- 保存成功后设 `settings.syncProvider='webdav'`：`setWebDAVConfig(config)` 后追加
  `useStore.getState().saveSettings({ ...useStore.getState().settings, webdav: config, syncProvider: 'webdav' })`。

- [ ] **Step 6: 全量编译**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: 无报错。

- [ ] **Step 7: 跑测试 + 构建冒烟**

Run: `npm test && npm run build`
Expected: 测试 PASS；build 成功产出 dist/ 与 dist-electron/。

- [ ] **Step 8: 手动验证（坚果云零回归）**

启动应用，用真实坚果云账号：连接→保存→编辑卡片→观察自动上传成功；改远端制造冲突→出现冲突卡→keep-local/use-remote 均正确。

- [ ] **Step 9: 提交**

```bash
git add electron/preload.ts src/types.ts src/store.ts src/App.tsx src/components/SettingsModal.tsx
git commit -m "refactor: 渲染层与 preload 改用 provider 无关 sync-* IPC"
```

---

### Task 11: 轮询变更检测 + 退避（省流量、抗限流）

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 8 adapter 的 `getRemoteTag`。
- Produces: `sync-periodic` 在远端 tag 未变时返回 `{ success: true, action: 'up-to-date' }` 而不下载整份；周期常量从 10s 放宽到 30s。

- [ ] **Step 1: main.ts periodic 走 tag 短路 + 缓存上次 tag**

在 main.ts 同步区加模块级变量与短路逻辑：
```ts
let lastRemoteTag: string | null = null

ipcMain.handle('sync-periodic', async () => enqueueSync(async () => {
  try {
    const adapter = getActiveAdapter()
    if (!adapter) return { success: false, error: '未配置同步' }
    if (adapter.getRemoteTag) {
      const tag = await adapter.getRemoteTag()
      const store = getLocalStore()
      const local = store.readSnapshot()
      const localDirty = !!local && store.getModifiedAt() > (local._syncTimestamp || 0) + 1500
      if (tag && tag === lastRemoteTag && !localDirty) {
        return { success: true, action: 'up-to-date' }
      }
      const result = await reconcileState(adapter, store)
      lastRemoteTag = tag
      return result
    }
    return reconcileState(adapter, getLocalStore())
  } catch (err) {
    return { success: false, error: String(err) }
  }
}))
```
（删除 Task 9 里旧的 `sync-periodic` handler，用本版替换。）

- [ ] **Step 2: App.tsx 周期常量放宽**

`src/App.tsx` 把 `const BACKGROUND_SYNC_INTERVAL_MS = 10000` 改为 `30000`。

- [ ] **Step 3: 编译 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 无报错；测试 PASS。

- [ ] **Step 4: 提交**

```bash
git add electron/main.ts src/App.tsx
git commit -m "perf: 周期同步加远端变更检测短路 + 放宽轮询间隔"
```

---

## Self-Review（计划 1）

**Spec 覆盖：**
- §2 架构（RemoteAdapter/LocalStore/engine/getActiveAdapter）→ Task 5/6/7/8/9 ✅
- §3 修复 1 texts → Task 3 ✅；修复 2 图片差异上传 → Task 7（uploadImagesDiff）✅；修复 3 轮询+退避 → Task 11 ✅
- §4 RemoteAdapter 接口 → Task 5/7/8 ✅
- §6 设置 schema syncProvider/迁移 → Task 9 getActiveAdapter + Task 10 types/SettingsModal ✅
- §7 引擎 provider 无关化、texts 摘要、图片差异、轮询 → Task 3/7/9/11 ✅
- §10 可测试性（FakeAdapter + 临时目录）→ Task 1/2/3/4/6/7 ✅
- 计划 2 范围（OneDriveAdapter/鉴权/UI/状态指示器/节流/pending）→ **不在本计划**，见计划 2。

**占位符扫描：** 无 TBD/TODO；删除清单用精确行号（以当前 HEAD `d5dd2b5` 为基准，执行时以函数名为准）。

**类型一致性：** `RemoteAdapter`/`LocalStore`/`SyncResult`/`SyncSummary(textCount)` 在 Task 5 定义，Task 7/8/9 使用一致；IPC 名 `sync-test/-auto/-startup/-periodic/-resolve-conflict` 在 Task 9/10 一致。

**已知顺序约束：** Task 9 编译可能因 renderer 旧引用暂时报跨文件错，Task 10 修复——已在 Task 9 Step 4 注明。
