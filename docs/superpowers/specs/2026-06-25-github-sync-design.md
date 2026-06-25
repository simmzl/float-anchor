# 设计文档：GitHub 同步（Contents API + PAT）

- 日期：2026-06-25
- 分支：`feat/sync-status-and-providers`（续在当前分支，与坚果云/状态展示同一 PR）
- 状态：已批准

## 1. 背景与目标

FloatAnchor 的同步引擎已重构为 provider 无关抽象（`RemoteAdapter` + `LocalStore` + `reconcileState`），当前有坚果云 WebDAV 后端 + 常驻同步状态展示。本次新增 **GitHub** 作为同步后端，并针对 GitHub 特性优化。

> 曾实现 OneDrive(Graph + 设备码)，因 Microsoft 强制 Azure 目录注册(需绑卡)门槛过高而移除；GitHub 用 **PAT 零注册**，正好绕开该问题。

### 成功标准
- 用户在设置选 GitHub，填入 `owner/repo` + fine-grained PAT(Contents 读写)，测试通过后保存即可同步；多设备一致。
- 复用现有引擎/冲突/状态/快路径，坚果云行为零回归。
- GitHub blob `sha` 同时驱动「远端未变跳过下载」快路径 + 上传乐观并发。

### 关键决策（已与用户确认）
- **认证**：fine-grained **PAT 粘贴**（非 OAuth）。
- **快照格式**：**明文 JSON**（不 gzip）。GitHub 上可读、每次保存=一个 commit(自带版本历史)、可看 diff；GitHub 无坚果云式流量配额，2MB 明文上传无压力。
- **分支策略**：续在 `feat/sync-status-and-providers`，GitHub 进同一 PR。

### 非目标（YAGNI）
- 不做 OAuth Device Flow、不做 Git Data API / 大文件分块（明文 2MB 走 Contents API 即可）。
- 不做 gzip 压缩、不做应用内版本浏览（去 GitHub 网页看 commit 历史）。
- 不动坚果云、文本框等既有功能。

## 2. GitHub Contents API 事实（设计依据，来自官方 REST 文档）

- 认证：fine-grained PAT，权限 **Contents: write** 即可；无需注册 OAuth App。认证用户 **5000 次/小时**。
- `PUT /repos/{owner}/{repo}/contents/{path}`：`content` 为 base64；**更新已存在文件必须带该文件当前 blob `sha`** → 天然乐观并发（sha 过期返回 409/422）。响应含新 `content.sha`。
- `GET .../contents/{path}`：默认返回元数据(含 `sha`/`size`)，文件 ≤1MB 时还内联 base64 `content`；**1–100MB 文件**只支持 `raw` / `object` 媒体类型（取原文用 `Accept: application/vnd.github.raw`，取元数据用默认/`object`，**不会传 2MB 内容**）。>100MB 不支持。
- 条件请求：支持 ETag/`If-None-Match` → 304 不计入费率。

## 3. 架构

```
渲染层(store/App/SettingsModal/SyncStatusIndicator) —— provider 无关 sync-* IPC + github-* 认证 IPC
主进程 getActiveAdapter() 按 settings.syncProvider 选 adapter:
   ├─ WebDAVAdapter（坚果云，既有）
   └─ GitHubAdapter（新增，Contents API + PAT）
   → 共用 reconcileState / 冲突 / 图片差异 / 快路径(remoteUnchanged) / refreshRemoteTag
```
- `SyncProvider` 类型：`'webdav' | 'github' | 'none'`。
- `getActiveAdapter`：新增 `provider === 'github' && settings.github?.repo && hasGitHubToken()` → `createGitHubAdapter({ repo, token, branch })`。

## 4. GitHubAdapter（实现 RemoteAdapter）

通用：基址 `https://api.github.com`，头 `Authorization: Bearer <PAT>`、`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`。路径：快照 `float-anchor.json`、图片 `images/{name}`（仓库根，分支默认 `main` 可配）。429/403 rate limit 读 `Retry-After`/`X-RateLimit-Reset` 退避一次。

实例内缓存 `currentSha`（同一次 runSync 复用同一 adapter 实例 → 上传时 sha 新鲜）。

- `test()`：GET `/repos/{owner}/{repo}` → 200 即 ok；401/403/404 返回对应错误。
- `getRemoteTag()`：GET `contents/float-anchor.json`（默认/`object` Accept，只取元数据）→ 返回 `sha`，并缓存；404 → null。
- `loadRemoteSnapshot()`：GET 元数据拿 `sha`(缓存) + GET 原文(`Accept: raw`，或元数据的 `download_url` 带 Authorization) → `{ data: JSON.parse(raw), tag: sha }`；404 → null。
- `uploadRemoteSnapshot(data)`：PUT `contents/float-anchor.json`，body `{ message, content: base64(JSON), sha: currentSha? , branch? }`；缺 sha=创建；返回新 sha 并缓存 → `{ tag: newSha }`。
- `listRemoteImages()`：GET `contents/images`（目录列表）→ `[{name, size}]`（并缓存各 sha 备 uploadImage 用）；404 → []。
- `uploadImage(name, buf)`：需要时先取该图 sha，PUT base64(buf) + sha?。
- `downloadImage(name)`：GET `contents/images/{name}`（`Accept: raw`）→ Buffer。

> 错误语义与 WebDAVAdapter 对齐：不存在返 null/[]，其它失败抛错（带 status）。

## 5. 认证 / 配置 / IPC

- `settings.github = { repo: string; branch?: string }`（非密，入 settings.json）。
- **PAT 经 electron `safeStorage` 加密**存独立文件 `<userData>/data/github-token.bin`，**不进 settings.json**、不打日志。
- 主进程 IPC：
  - `github-test({ repo, token, branch })` → `createGitHubAdapter(...).test()`。
  - `github-save-token(token)` → 加密写盘；`github-clear-token()`；`github-has-token()` → bool。
  - `github-account()` → GET `/user` 取 `login`（显示已连接账号）。
- preload 暴露上述方法 + types 声明。
- 设置面板 GitHub 子面板：`owner/repo` 输入 + PAT 密码框 + 「测试连接」+「保存」+「断开」+ 一句「生成 fine-grained PAT：仅授予该仓库 Contents 读写」指引。保存成功 → `github-save-token` + `settings.github={repo,branch}` + `syncProvider='github'` + 触发一次 syncAuto。

## 6. 错误展示（扩展 describeSyncError）

新增 GitHub 分支：401/403(非 rate)→「GitHub 令牌无效或权限不足」；403 + rate limit 头 →「GitHub 请求超限，请稍后再试」；404→「GitHub 仓库或文件不存在」；409/422→「云端已更新，正在重新同步」。其余沿用通用映射。

## 7. 复用与零回归

复用：`reconcileState`/`resolveConflict`/冲突确认 UI/侧栏 `SyncStatusIndicator`/`pending`/上传节流/`remoteUnchanged` 快路径/`refreshRemoteTag`/`getEffectiveProvider`/provider 选择器(加 GitHub 选项)。坚果云路径与既有 UI 行为不变。

## 8. 测试

- GitHubAdapter：vitest 中 mock 全局 `fetch`，覆盖请求 URL/头构造、sha 提取与缓存、404→null、PUT 带 sha、loadRemoteSnapshot 解析。
- 真机：用 `gh` 创建私有测试仓库 `float-anchor-sync-test`，手验 连接/保存/自动同步/冲突/多设备 sha 乐观并发。
- 既有 31 单测保持绿；tsc(renderer + electron) + build 通过。

## 9. 实现阶段（供实现计划参考）

1. GitHubAdapter 模块 + fetch-mock 单测。
2. PAT 加密存储 + github-* IPC + preload + types（`SyncProvider` 加 'github'、`settings.github`）。
3. getActiveAdapter github 分支 + describeSyncError GitHub 错误。
4. 设置面板 provider 选择器加 GitHub 选项 + GitHub 子面板。
5. 真机私有仓库手验。
