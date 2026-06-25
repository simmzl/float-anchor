# 设计文档：粘贴图片外链化 + 存量迁移

- 日期：2026-06-25
- 分支：`feat/image-externalize`（基于已合并同步工作的 main）
- 状态：已批准

## 1. 背景与目标

FloatAnchor 的富文本编辑器 `RichEditor.tsx` 在**粘贴 / 拖拽 / 插入**图片时，走 `fileToBase64()` 把图片转成 `data:image/...;base64,...` 直接内嵌进卡片 content。后果：

- 卡片正文里塞满 base64，`float-anchor.json` 快照非常大（实测约 2MB），同步慢、坚果云易触发流量限制。
- 同一张图重复粘贴会重复存储。

但项目**已具备完整的本地图片机制**：
- 主进程注册并实现了 `fa-img://` 协议（`electron/main.ts`），从 `<userData>/data/images/` 读取文件并返回。
- 同步层（`electron/sync/`）的 `getReferencedImageNames` 已扫描 content 里的 `fa-img://` 引用，并对 `images/` 做**图片差异上下行**。

**根因**：粘贴这条路绕开了已有的外链机制，直接 base64 内嵌。

### 目标
1. 粘贴/拖拽/插入图片时，把图片**存成文件**到 images 目录、content 里只放 `fa-img://{name}` 引用，不再 base64 内嵌。
2. 提供**手动迁移**：把现有卡片正文里已内嵌的 base64 图片抽成文件、替换为 `fa-img://` 引用，让现有大 JSON 立刻瘦身。
3. 同步零改动即受益：JSON 变小、图片仅在变化时作为独立文件同步。

### 关键决策（已与用户确认）
- **存量迁移**：设置里**手动按钮**触发（显式、可见前后体积、迁移前自动备份）。**不**做启动自动迁移。
- **不压缩**：仅外链化，不降采样/不转码（无损保真）。
- **分支**：PR#1（同步）合并后，从 main 新开 `feat/image-externalize`。

### 非目标（YAGNI）
- 不做图片压缩/降采样/格式转换。
- 不做启动自动迁移。
- 不清理远端孤儿图片（跨设备误删风险，沿用既有决策）。
- 不改同步引擎（`fa-img://` 已被覆盖）。

## 2. 组件设计

### 2.1 `save-image` IPC（主进程）
`saveImage(bytes: ArrayBuffer, mime?: string) → { name: string }`
- 把 `bytes` 转 Buffer，算 **sha256**，取前 16 位 hex。
- 扩展名：优先由 `mime`（`image/png→png`、`image/jpeg→jpg`、`image/gif→gif`、`image/webp→webp`）；兜底用 magic bytes 嗅探（复用 `local-store` 的 `isRealImageFile` 同款字节识别）；再兜底 `png`。
- 文件名 `{hash16}.{ext}` 写入 `<userData>/data/images/`；**已存在则跳过**（内容寻址去重）。
- 返回 `{ name }`。preload 暴露 `saveImage`，types 声明。

### 2.2 RichEditor 改造
现有三处（粘贴 `paste`、拖拽 `drop`、「插入图片」按钮 `insertImage`）都是 `fileToBase64(file).then(src => editor.setImage({ src }))`。改为：
```
file → file.arrayBuffer() → window.electronAPI.saveImage(buf, file.type)
     → editor.chain().focus().setImage({ src: `fa-img://${name}` }).run()
```
- `saveImage` 抛错时**回退**到原 `fileToBase64`（保证粘贴永不失败）。
- 抽一个 `insertImageFile(editor, file)` 公共函数，三处复用。

### 2.3 存量迁移（设置 → 数据管理 →「提取内嵌图片为文件」）
按钮 → IPC `migrate-embedded-images`（主进程，操作 `float-anchor.json`）：
1. `createBackup()` 先备份。
2. 读数据，遍历每个 canvas 的每张 card 的 `content`，用纯函数扫描 `<img src="data:image/...;base64,...">`（HTML 形态，tiptap 输出）。
3. 每个 data URL：解码 base64 → 字节 → 按 2.1 规则存盘（sha256 去重）→ 把该 data URL 替换为 `fa-img://{name}`。
4. 写回数据文件，返回 `{ count, beforeBytes, afterBytes }`。
- 渲染层收到后 `loadData()` + `refreshImageCache()`，提示「提取了 N 张图，JSON 从 X 缩到 Y」。
- 仅处理 `card.content`（TextBox/标题为纯文本，无图）。

### 2.4 同步兼容
迁移/新粘贴后 content 含 `fa-img://`，已被 `getReferencedImageNames` 扫描 + 图片差异同步覆盖，**无需改同步代码**。JSON 瘦身 → 快照上下行变小；图片只在新增/变化时作为独立文件传。

## 3. 数据流

- **粘贴**：图字节 → `save-image`（写文件、去重）→ editor content 得 `<img src="fa-img://hash.png">` → 持久化 JSON 仅含引用 → 同步：小 JSON + 该新图文件（差异）。
- **迁移**：扫描 content 的 data URL → 解码存盘 → 替换为 `fa-img://` → 持久化 → 同步。
- **显示**：`fa-img://hash.png` 由主进程协议处理器从 images 目录读出渲染。

## 4. 错误处理
- `save-image` 失败 → RichEditor 回退 base64 + console 记录；不阻断粘贴。
- 迁移：先备份；单张 base64 解码/存盘失败则跳过该张、继续其余，计入跳过数；整体失败返回 error。
- 损坏/非图片 data URL → 跳过。

## 5. 可测试性
- **纯函数可测**（vitest）：
  - `extFromMime(mime)` / sha256+ext 命名规则。
  - 迁移核心 `rewriteEmbeddedImages(content, save) → { content, extracted }`：给定含 data URL 的 HTML 字符串 + 一个注入的 save 回调，断言返回的 content 里 data URL 被替换为 `fa-img://`、save 被以正确字节调用。
- **人工 GUI 验证**：真实粘贴截图 → content 存 `fa-img://`、图片正常显示、JSON 不再膨胀；迁移按钮 → 体积下降、图片仍显示、同步正常。

## 6. 实现阶段（供实现计划参考）
1. 纯函数模块：ext/哈希命名 + `rewriteEmbeddedImages` + vitest。
2. `save-image` + `migrate-embedded-images` IPC（主进程）+ preload + types。
3. RichEditor 三处改造（`insertImageFile` 公共函数 + 回退）。
4. 设置「提取内嵌图片为文件」按钮 + 结果提示。
5. 人工 GUI 验证。
