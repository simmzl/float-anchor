# 粘贴图片外链化 + 存量迁移 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 粘贴/拖拽/插入图片时存成文件并以 `fa-img://` 引用（不再 base64 内嵌），并提供手动迁移把现有内嵌 base64 抽成文件，让 JSON 瘦身、图片仅在变化时差异同步。

**Architecture:** 新增纯函数模块 `electron/sync/image-store.ts`（哈希命名 + 扫描替换 data URL，可测）；主进程加 `save-image` / `migrate-embedded-images` IPC；RichEditor 三处粘贴改走 save-image（失败回退 base64）；设置加迁移按钮。复用既有 `fa-img://` 协议与图片差异同步，**同步引擎零改动**。

**Tech Stack:** Electron 28（主进程 `fetch`/`fs`/`crypto`）、TypeScript、React、tiptap（@tiptap/extension-image）、vitest。

## Global Constraints

- 语言：面向用户文案简体中文。
- `card.content` 存为 **Markdown**（编辑器 `onChange` 用 turndown 存）；内嵌图形态 `![](data:image/...;base64,...)`。迁移按 `data:image/...;base64,...` token 正则匹配（覆盖 markdown 与偶发 HTML）。
- 图片文件名 = sha256(字节) 前 16 位 hex + 扩展名；写入 `<userData>/data/images/`；**已存在则跳过（去重）**。
- 引用形态统一 `fa-img://{name}`（既有协议 + 同步层 `getReferencedImageNames` 已覆盖）。
- 不压缩/不降采样；不自动迁移；不清理远端孤儿图；不改同步引擎。
- 迁移前 `getLocalStore().backup()` 自动备份；保留 `_syncTimestamp`（让 mtime 变化触发上传）。
- `electron/sync/image-store.ts` 纯函数，不顶层 import electron（用 node:crypto），vitest 可跑。
- 提交 message 中文 `feat:/test:` 前缀。
- 设计依据：`docs/superpowers/specs/2026-06-25-image-externalize-design.md`。

### electron 类型检查命令（多处复用；项目默认 tsc 不覆盖 electron/，main.ts 有一条既有无关 TS2339）
```bash
cd "$(git rev-parse --show-toplevel)"
cat > tsconfig.electron-check.json <<'JSON'
{ "compilerOptions": { "target":"ES2020","lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","moduleResolution":"bundler","skipLibCheck":true,"resolveJsonModule":true,"strict":true,"noEmit":true,"esModuleInterop":true,"types":["node"] }, "include":["electron"] }
JSON
npx tsc --noEmit -p tsconfig.electron-check.json 2>&1 | grep "error TS" | grep -v "prepare-clear\|does not exist on type"
rm -f tsconfig.electron-check.json tsconfig.node.tsbuildinfo
# 无输出 = 除既有 clear-data 错误外类型干净
```

---

### Task 1: image-store 纯函数模块 + 单测（TDD）

**Files:**
- Create: `electron/sync/image-store.ts`
- Create: `electron/sync/image-store.test.ts`

**Interfaces:**
- Produces:
  - `extFromMime(mime?: string): string`（已知 mime→ext，未知→''）
  - `sniffExt(buf: Buffer): string`（magic bytes→ext，未知→''）
  - `resolveExt(mime: string | undefined, buf: Buffer): string`（mime→嗅探→'png' 兜底）
  - `hashName(buf: Buffer, ext: string): string`（`{sha256前16}.{ext}`）
  - `rewriteEmbeddedImages(content: string, save: (buf: Buffer, mime: string) => string): { content: string; extracted: number }`

- [ ] **Step 1: 写失败测试**

Create `electron/sync/image-store.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { extFromMime, sniffExt, resolveExt, hashName, rewriteEmbeddedImages } from './image-store'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])

describe('extFromMime / sniffExt / resolveExt', () => {
  it('mime 映射', () => {
    expect(extFromMime('image/png')).toBe('png')
    expect(extFromMime('image/jpeg')).toBe('jpg')
    expect(extFromMime('image/webp')).toBe('webp')
    expect(extFromMime('application/x')).toBe('')
  })
  it('magic bytes 嗅探', () => {
    expect(sniffExt(PNG)).toBe('png')
    expect(sniffExt(JPG)).toBe('jpg')
    expect(sniffExt(Buffer.from([1, 2, 3]))).toBe('')
  })
  it('resolveExt 优先 mime，其次嗅探，再兜底 png', () => {
    expect(resolveExt('image/gif', PNG)).toBe('gif')
    expect(resolveExt(undefined, JPG)).toBe('jpg')
    expect(resolveExt(undefined, Buffer.from([1, 2]))).toBe('png')
  })
})

describe('hashName', () => {
  it('同内容同名（去重）、含扩展名', () => {
    const a = hashName(PNG, 'png')
    const b = hashName(PNG, 'png')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}\.png$/)
  })
})

describe('rewriteEmbeddedImages', () => {
  it('把 markdown 里的 data URL 替换为 fa-img:// 并调用 save', () => {
    const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const content = `前文 ![](data:image/png;base64,${png1x1}) 后文`
    const saved: { mime: string; len: number }[] = []
    const save = vi.fn((buf: Buffer, mime: string) => { saved.push({ mime, len: buf.length }); return 'deadbeefdeadbeef.png' })
    const res = rewriteEmbeddedImages(content, save)
    expect(res.extracted).toBe(1)
    expect(res.content).toBe('前文 ![](fa-img://deadbeefdeadbeef.png) 后文')
    expect(save).toHaveBeenCalledTimes(1)
    expect(saved[0].mime).toBe('image/png')
    expect(saved[0].len).toBeGreaterThan(0)
  })
  it('无 data URL 时原样返回，extracted=0', () => {
    const res = rewriteEmbeddedImages('![](fa-img://x.png) 纯文本', vi.fn())
    expect(res.extracted).toBe(0)
    expect(res.content).toBe('![](fa-img://x.png) 纯文本')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（image-store 未实现）。

- [ ] **Step 3: 写实现**

Create `electron/sync/image-store.ts`:
```ts
import crypto from 'node:crypto'

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
}

export function extFromMime(mime?: string): string {
  if (!mime) return ''
  return MIME_EXT[mime.toLowerCase()] || ''
}

export function sniffExt(buf: Buffer): string {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return ''
}

export function resolveExt(mime: string | undefined, buf: Buffer): string {
  return extFromMime(mime) || sniffExt(buf) || 'png'
}

export function hashName(buf: Buffer, ext: string): string {
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  return `${hash}.${ext || 'png'}`
}

// 扫描 content 里的 data:image/...;base64,... token，逐个交给 save 存盘并替换为 fa-img://{name}
const DATA_URL_RE = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g

export function rewriteEmbeddedImages(
  content: string,
  save: (buf: Buffer, mime: string) => string,
): { content: string; extracted: number } {
  let extracted = 0
  const out = content.replace(DATA_URL_RE, (full, subtype, b64) => {
    try {
      const buf = Buffer.from(b64, 'base64')
      if (buf.length === 0) return full
      const name = save(buf, `image/${subtype}`)
      extracted += 1
      return `fa-img://${name}`
    } catch {
      return full
    }
  })
  return { content: out, extracted }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS（含 image-store 用例；总数 36+本任务新增）。

- [ ] **Step 5: 提交**

```bash
git add electron/sync/image-store.ts electron/sync/image-store.test.ts
git commit -m "feat: image-store 纯函数（哈希命名 + 内嵌图扫描替换）+ 单测"
```

---

### Task 2: save-image / migrate-embedded-images IPC + preload + types

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: Task 1 `resolveExt`/`hashName`/`rewriteEmbeddedImages`；既有 `getDataPaths`/`getLocalStore`。
- Produces IPC：`save-image(bytes, mime?) → { name?: string; error?: string }`；`migrate-embedded-images() → { success: boolean; count?: number; beforeBytes?: number; afterBytes?: number; error?: string }`。preload `saveImage`/`migrateEmbeddedImages`；types 声明。

- [ ] **Step 1: main.ts 加 saveImageBytes + 两个 IPC**

`electron/main.ts` 顶部 import：
```ts
import { resolveExt, hashName, rewriteEmbeddedImages } from './sync/image-store'
```
在同步区附近加：
```ts
function saveImageBytes(buf: Buffer, mime?: string): string {
  const { dataDir } = getDataPaths()
  const imagesDir = path.join(dataDir, 'images')
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true })
  const ext = resolveExt(mime, buf)
  const name = hashName(buf, ext)
  const dest = path.join(imagesDir, name)
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf)
  return name
}

ipcMain.handle('save-image', async (_e, bytes: ArrayBuffer, mime?: string) => {
  try {
    return { name: saveImageBytes(Buffer.from(bytes), mime) }
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('migrate-embedded-images', async () => {
  try {
    const { dataFile } = getDataPaths()
    if (!fs.existsSync(dataFile)) return { success: false, error: '无数据文件' }
    const raw = fs.readFileSync(dataFile, 'utf-8')
    const beforeBytes = Buffer.byteLength(raw, 'utf-8')
    getLocalStore().backup()
    const data = JSON.parse(raw)
    let count = 0
    for (const canvas of data?.canvases || []) {
      for (const card of canvas?.cards || []) {
        if (typeof card?.content === 'string' && card.content.includes('data:image/')) {
          const { content, extracted } = rewriteEmbeddedImages(card.content, saveImageBytes)
          card.content = content
          count += extracted
        }
      }
    }
    const newRaw = JSON.stringify(data, null, 2)
    fs.writeFileSync(dataFile, newRaw, 'utf-8')
    return { success: true, count, beforeBytes, afterBytes: Buffer.byteLength(newRaw, 'utf-8') }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})
```
注意：保留 `data._syncTimestamp`（JSON.parse 自带，写回不动它）——writeFileSync 改 mtime → 下次同步判脏上传。

- [ ] **Step 2: preload 暴露**

`electron/preload.ts` 加：
```ts
  saveImage: (bytes: ArrayBuffer, mime?: string) => ipcRenderer.invoke('save-image', bytes, mime),
  migrateEmbeddedImages: () => ipcRenderer.invoke('migrate-embedded-images'),
```

- [ ] **Step 3: types.ts 声明**

`src/types.ts` 的 `window.electronAPI` 加：
```ts
      saveImage: (bytes: ArrayBuffer, mime?: string) => Promise<{ name?: string; error?: string }>
      migrateEmbeddedImages: () => Promise<{ success: boolean; count?: number; beforeBytes?: number; afterBytes?: number; error?: string }>
```

- [ ] **Step 4: 校验**

运行 electron 类型检查命令（除既有 main.ts 错误外无输出）；`npx tsc --noEmit -p tsconfig.json` 无报错；`npm test` 仍全绿。

- [ ] **Step 5: 提交**

```bash
git add electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat: save-image / migrate-embedded-images IPC + preload/types"
```

---

### Task 3: RichEditor 三处粘贴改走 save-image（失败回退 base64）

**Files:**
- Modify: `src/components/RichEditor.tsx`

**Interfaces:**
- Consumes: Task 2 `window.electronAPI.saveImage`。

- [ ] **Step 1: 加 insertImageFile 公共函数**

`src/components/RichEditor.tsx` 在 `fileToBase64`（约 66 行）下方加（`Editor` 类型从 `@tiptap/react` 已间接可用；用 `any` 亦可）：
```ts
async function insertImageFile(editor: ReturnType<typeof useEditor>, file: File) {
  if (!editor) return
  try {
    const buf = await file.arrayBuffer()
    const res = await window.electronAPI.saveImage(buf, file.type)
    if (res?.name) {
      editor.chain().focus().setImage({ src: `fa-img://${res.name}` }).run()
      return
    }
  } catch { /* 落到下面回退 */ }
  const src = await fileToBase64(file) // 回退：保证粘贴永不失败
  editor.chain().focus().setImage({ src }).run()
}
```
（若 `ReturnType<typeof useEditor>` 类型不便，用 `editor: any`。）

- [ ] **Step 2: handlePaste 改用 insertImageFile**

把 handlePaste 内：
```ts
            fileToBase64(file).then((src) => {
              editor?.chain().focus().setImage({ src }).run()
            })
```
改为：
```ts
            void insertImageFile(editor, file)
```

- [ ] **Step 3: handleDrop 改用 insertImageFile**

把 handleDrop 内同样的 `fileToBase64(file).then(...)` 块改为：
```ts
            void insertImageFile(editor, file)
```

- [ ] **Step 4: insertImage 按钮改用 insertImageFile**

把 `insertImage` useCallback 内：
```ts
      const src = await fileToBase64(file)
      editor.chain().focus().setImage({ src }).run()
```
改为：
```ts
      await insertImageFile(editor, file)
```

- [ ] **Step 5: 校验**

`npx tsc --noEmit -p tsconfig.json` 无报错；`npm test` 全绿；`npm run build` 成功。

- [ ] **Step 6: 提交**

```bash
git add src/components/RichEditor.tsx
git commit -m "feat: 粘贴/拖拽/插入图片改为存盘 fa-img 引用（失败回退 base64）"
```

---

### Task 4: 设置「提取内嵌图片为文件」按钮

**Files:**
- Modify: `src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: Task 2 `window.electronAPI.migrateEmbeddedImages`。

- [ ] **Step 1: 加 state + handler**

`src/components/SettingsModal.tsx` 组件内加：
```ts
const [migrateStatus, setMigrateStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
const [migrateMessage, setMigrateMessage] = useState('')

const fmtKB = (b?: number) => b == null ? '?' : (b / 1024 >= 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)

const handleMigrateImages = useCallback(async () => {
  setMigrateStatus('running'); setMigrateMessage('')
  try {
    const res = await window.electronAPI.migrateEmbeddedImages()
    if (res.success) {
      await useStore.getState().loadData()
      useStore.getState().refreshImageCache()
      setMigrateStatus('done')
      setMigrateMessage(res.count ? `已提取 ${res.count} 张内嵌图，数据从 ${fmtKB(res.beforeBytes)} 缩到 ${fmtKB(res.afterBytes)}` : '没有发现内嵌图片')
      setTimeout(() => { setMigrateStatus('idle'); setMigrateMessage('') }, 8000)
    } else {
      setMigrateStatus('error'); setMigrateMessage(res.error || '提取失败')
      setTimeout(() => { setMigrateStatus('idle'); setMigrateMessage('') }, 6000)
    }
  } catch {
    setMigrateStatus('error'); setMigrateMessage('提取时发生错误')
    setTimeout(() => { setMigrateStatus('idle'); setMigrateMessage('') }, 6000)
  }
}, [])
```

- [ ] **Step 2: 在「数据管理」区加按钮**

在数据管理 section（导出/导入按钮附近）加一行：
```tsx
<div className="data-management-item">
  <button className="data-btn" onClick={handleMigrateImages} disabled={migrateStatus === 'running'}>
    {migrateStatus === 'running' ? '提取中...' : '提取内嵌图片为文件'}
  </button>
  <span className="data-hint">把笔记里 base64 内嵌的图片抽成本地文件，显著减小数据体积</span>
</div>
{migrateMessage && (
  <div className={`data-message ${migrateStatus === 'error' ? 'error' : 'success'}`}>{migrateMessage}</div>
)}
```

- [ ] **Step 3: 校验**

`npx tsc --noEmit -p tsconfig.json` 无报错；`npm test` 全绿；`npm run build` 成功。

- [ ] **Step 4: 提交**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: 设置增加「提取内嵌图片为文件」迁移按钮"
```

---

### Task 5: 端到端人工 GUI 验证

**Files:** 无（验证）。

- [ ] **Step 1:** `npm run dev` 启动。粘贴一张截图 → 图片正常显示；右键卡片看不到巨大 base64（或用 DevTools 看 content 为 `![](fa-img://...)`）。
- [ ] **Step 2:** 多次粘贴**同一张**图 → images 目录只生成一个文件（去重）。
- [ ] **Step 3:** 设置 → 数据管理 →「提取内嵌图片为文件」→ 提示「已提取 N 张，从 X 缩到 Y」；图片仍正常显示；`float-anchor.json` 体积明显下降。
- [ ] **Step 4:** 若已配置同步（GitHub/坚果云）→ 同步后远端快照变小，图片作为独立文件出现在 `images/`。

---

## Self-Review（计划）

**Spec 覆盖：** §2.1 save-image→Task2；§2.2 RichEditor→Task3；§2.3 迁移→Task2(IPC)+Task4(按钮)；§2.4 同步零改动（无任务=正确，复用既有）；§5 纯函数测试→Task1。

**占位符扫描：** 无 TBD；Task5 为人工验证。

**类型一致性：** `saveImage`/`migrateEmbeddedImages` 返回类型、`resolveExt`/`hashName`/`rewriteEmbeddedImages` 签名、`fa-img://{name}` 形态在 Task1/2/3/4 一致。

**依赖顺序：** Task1→2→3/4→5。Task3、Task4 都依赖 Task2 的 IPC，彼此独立。
