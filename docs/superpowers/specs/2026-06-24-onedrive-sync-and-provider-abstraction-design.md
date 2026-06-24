# 设计文档：OneDrive 同步 + SyncProvider 抽象

- 日期：2026-06-24
- 分支：`feat/github-sync`（实际实现 OneDrive；分支名沿用，不再改）
- 状态：已批准

## 1. 背景与目标

FloatAnchor 当前只有一种云同步后端：**坚果云 WebDAV**。同步逻辑集中在 `electron/main.ts`，
以 `reconcileWebDAVState()` 为核心：用 JSON 内嵌的 `_syncTimestamp` + 本地文件 mtime「脏判定」
+ 内容指纹三者比对，决定 上传 / 下载 / 弹冲突确认；图片单独同步；并发经 `enqueueWebDAVSync` 串行队列；
应用远端前会本地备份，并对「高危云端覆盖」拦截确认。

本次目标：

1. **新增 OneDrive 作为可选云同步后端**，与坚果云并列。
2. **同时只启用一个同步源**（设置里二选一或关闭），避免双写互相覆盖。
3. **把同步引擎重构为 provider 无关**：抽出 `RemoteAdapter` 接口，WebDAV / OneDrive 各实现一个，
   reconcile / 冲突 / 高危 / 摘要逻辑全部共用。
4. **主界面常驻可感知的同步状态**：等待 / 同步中 / 成功 / 失败 / 待确认都要在界面上有体现。
5. 顺带修复评审中发现的 3 个问题（见 §3）。

### 成功标准

- 用户在设置里选择 OneDrive，点「连接」后通过**设备码登录**（不填密码/token）完成授权，
  之后编辑笔记能自动同步到 OneDrive，多设备间一致。
- 切换到坚果云时行为与今天完全一致（零回归）。
- 只有文本框的画布不再被云端空数据静默覆盖。
- 侧栏常驻一个同步状态指示器，状态变化用户能直接看到。
- OneDrive 文件可在网页端用其自带「版本历史」查看 / 还原。

### 非目标（YAGNI / 本次不做）

- app 内的 OneDrive 版本历史面板（靠 OneDrive 网页端兜底）。
- 远端孤儿图片清理（跨设备误删风险高）。
- WebDAV 密码加密（维持现状；OneDrive token 会加密）。
- 真正的语义级 3-way 合并（冲突仍是整边取舍）。
- Dropbox / iCloud / Google Drive 等其他后端（架构留口，本次不实现）。

## 2. 架构

```
渲染层  store.ts / App.tsx / SettingsModal.tsx / Sidebar.tsx
   │  调用 provider 无关 IPC：
   │    sync-test / sync-startup / sync-periodic / sync-auto / sync-resolve-conflict
   │  + OneDrive 鉴权：onedrive-connect / -disconnect / -status / -cancel-connect
   ▼
主进程  同步编排（provider 无关）
   reconcileState(adapter) · enqueueSync 串行队列 · buildSyncDecision · summarizeSyncData
   · 图片差异同步 · 轮询变更检测 · 429/错误退避
   └─ 依赖 RemoteAdapter 接口
         ├─ WebDAVAdapter   （包装现有 webdav 逻辑，行为不变）
         └─ OneDriveAdapter （Graph REST + 设备码鉴权 + token 刷新 + safeStorage）
```

把 `reconcileWebDAVState` 里的远端原语（读/写远端 JSON、列/传/下图片、连通性测试）抽到
`RemoteAdapter`；reconcile 决策、冲突判定、高危覆盖检测、数据摘要全部 provider 无关并复用。
主进程通过 `getActiveAdapter()` 依据 `settings.syncProvider` 选择实例。

## 3. 评审结论与本次修复

当前方案的优点（保留）：本地优先永不阻塞首屏、串行队列防并发、高危覆盖拦截、覆盖前备份、
图片用 magic bytes 校验真实性。

本次**修复**的问题：

1. **texts 未纳入同步保护（真实 bug）**——`summarizeSyncData` / `hasMeaningfulSyncData` /
   `isHighRiskRemoteOverwrite` / `formatSyncSummary` 只数 cards/labels/sections/connections，
   不数 texts。后果：一个**只有文本框**的画布被判为「无意义数据」，可能被云端空数据静默覆盖、
   且不弹高危确认。（正常同步里 texts 随整体 JSON 正常上下行，不丢数据，只是高危保护有盲区。）
2. **图片每次全量上传**——`uploadLocalImages` 每次把所有本地图片重传一遍。改为差异上传。
3. **轮询太激进**——每 10s 全量读远端 JSON、无条件 GET。改为放宽周期 + 远端变更检测 + 退避。

本次**暂不修**（记录在案）：远端孤儿图清理、WebDAV 密码加密、语义级合并。

## 4. RemoteAdapter 接口

```ts
interface RemoteImageEntry { name: string; size: number }

interface RemoteAdapter {
  // 连通性测试
  test(): Promise<{ ok: boolean; error?: string }>
  // 远端快照 JSON；不存在返回 null；tag = 并发/变更令牌（WebDAV: mtime / OneDrive: eTag）
  loadRemoteSnapshot(): Promise<{ data: AppData; tag?: string } | null>
  uploadRemoteSnapshot(data: AppData, opts?: { ifMatch?: string }): Promise<{ tag?: string }>
  // 轮询前的轻量变更探测；返回 null 表示不支持（退回 _syncTimestamp 逻辑）
  getRemoteTag?(): Promise<string | null>
  // 图片
  listRemoteImages(): Promise<RemoteImageEntry[]>
  uploadImage(name: string, buf: Buffer): Promise<void>
  downloadImage(name: string): Promise<Buffer>
}
```

- **WebDAVAdapter**：包装现有 `getWebDAVClient` + 各 webdav 函数；`getRemoteTag` 用 PROPFIND mtime
  （拿不到返回 null，退回现有 `_syncTimestamp` 逻辑）。其余行为与今天**逐字节一致**，保证零回归。
- **OneDriveAdapter**：`tag` = 文件 eTag；`getRemoteTag` / `loadRemoteSnapshot` 用 `If-None-Match`
  条件 GET（304 即跳过整份下载）；`uploadRemoteSnapshot` 可带 `If-Match` 做乐观并发。

reconcile 引擎签名从 `reconcileWebDAVState(config)` 改为 `reconcileState(adapter)`，便于注入
内存版 fake adapter 做单测。

## 5. OneDrive 接入细节

### 5.1 鉴权（设备码流，全在主进程）

- authority：`https://login.microsoftonline.com/common`（支持个人 + 工作/学校账户）。
- scope：`Files.ReadWrite.AppFolder offline_access User.Read`。
- 流程（`onedrive-connect`）：
  1. POST `/common/oauth2/v2.0/devicecode` → 拿 `device_code` / `user_code` / `verification_uri`
     / `interval` / `expires_in`。
  2. 把 `user_code` + `verification_uri` 推给渲染层，显示「打开 microsoft.com/devicelogin
     输入 ABCD-EFGH」+ 一键打开授权页按钮。
  3. 按 `interval` 轮询 POST `/common/oauth2/v2.0/token`（grant_type=device_code），
     处理 `authorization_pending`（继续轮询）/ `slow_down`（加大间隔）/ `expired_token`（重启）
     / `access_denied`（用户拒绝）。
  4. 成功拿到 `access_token` + `refresh_token` + `expires_in`。
- token 存储：`refresh_token` 用 electron **`safeStorage` 加密**写入独立文件
  `<userData>/float-anchor/data/onedrive-token.bin`（**不**放 settings.json）；`access_token`
  仅驻内存，过期用 `refresh_token` 刷新；刷新失败（被撤销/过期）→ 清 token、标记断开、提示重连。
- 其他 IPC：`onedrive-disconnect`（清 token）/ `onedrive-status`（连接状态 + 账号邮箱，via
  `GET /me` 的 `userPrincipalName`/`mail`）/ `onedrive-cancel-connect`（取消轮询）。

### 5.2 存储位置

- 应用专属文件夹（AppFolder）`special/approot` 下：
  - 快照：`PUT /me/drive/special/approot:/float-anchor.json:/content`
  - 图片：`/me/drive/special/approot:/images/{name}:/content`，列举用
    `GET /me/drive/special/approot:/images:/children`
- 用户在 OneDrive 网页 `Apps/FloatAnchor/` 下能看到文件，并用自带「版本历史」查看 / 还原。
- `Files.ReadWrite.AppFolder` 限定只能访问这个应用文件夹，授权更安全、用户更易同意。

### 5.3 前置：Azure 应用注册（维护者一次性手动）

1. Entra/Azure 门户「应用注册」→ 新建。
2. 受众选「任意组织目录 + 个人 Microsoft 账户」。
3. 「身份验证」→ Allow public client flows = **是**（启用设备码流）。
4. 「API 权限」→ 加委托权限 `Files.ReadWrite.AppFolder` + `offline_access` + `User.Read`。
5. 复制 Application(client) ID，填入代码常量 `ONEDRIVE_CLIENT_ID`。
   - device flow 是公共客户端、**无 client secret**，client ID 内嵌进源码是安全且标准的做法。
6. 代码中留好占位常量 + 注释步骤；未填时 OneDrive 选项禁用并提示「需配置 Client ID」。

## 6. 设置 schema 与迁移

```ts
type SyncProvider = 'webdav' | 'onedrive' | 'none'

interface AppSettings {
  theme: 'light' | 'dark'
  webdav?: WebDAVConfig
  syncProvider?: SyncProvider              // 当前启用哪个，缺省按迁移规则推断
  onedrive?: { connected: boolean; account?: string }   // token 不在这里
}
```

- 迁移：老用户有 `webdav.server` 且无 `syncProvider` → 视为 `syncProvider='webdav'`，行为不变。
- 无任何配置 → `'none'`。
- OneDrive 的敏感 token 不进 settings.json，单独加密文件存储（见 §5.1）。

## 7. 同步引擎改动

- **provider 无关化**：`reconcileState(adapter)` / `resolveConflict(adapter, resolution)`；
  IPC 由渲染层不再逐次传 config，改为主进程 `getActiveAdapter()` 读 settings 选实例。
  （`sync-test` 仍接收 WebDAV 表单 config 用于保存前测试；OneDrive 的「测试」即连接流程。）
- **修 texts 盲区**：`SyncSummary` 增 `textCount`，纳入 `totalEntityCount` /
  `hasMeaningfulSyncData` / `isHighRiskRemoteOverwrite` / `formatSyncSummary` 与 UI 展示。
  同步类型 `WebDAVSyncSummary` 重命名/复用为通用 `SyncSummary`（含 `textCount`）。
- **图片差异上传**：列远端图片(name+size)，只上传「远端缺失或大小不同」者，替代每次全量上传。
  下载仍只下「被引用且本地缺失」者（现状保留）。
- **轮询 + 退避**：周期 10s → 默认 ~30s（常量集中）；每次先 `getRemoteTag()` 判远端是否变化，
  没变直接跳过整份下载；遇 `429` 按 `Retry-After` 退避，连续失败指数退避。
- **远端上传节流**：本地保存即时落盘不变；**远端上传**加最小间隔合并（默认 ~30s）+ 应用退出/
  窗口失焦时 flush，既减少 API 调用，又让 OneDrive 版本历史不被近似快照塞满。

## 8. UI

### 8.1 设置面板（SettingsModal）

「云同步」区改为 **provider 选择器**（坚果云 WebDAV / OneDrive / 关闭）→ 选中谁显示谁的子表单：

- **WebDAV 子表单**：同今天（服务器/账号/应用密码/测试/保存/同步/断开）。
- **OneDrive 子面板**：
  - 未连接：「连接 OneDrive」按钮 → 弹出设备码 + verification_uri + 一键打开授权页 + 轮询状态
    （等待授权 / 成功 / 超时 / 已取消）。
  - 已连接：显示账号邮箱 + 「同步」「断开」按钮 + 一句「版本历史请到 OneDrive 网页端查看」。
- 同步状态点 + 冲突决策卡 = provider 无关，两个 provider 共用同一套。

### 8.2 主界面常驻同步状态（新增需求）

新增状态 `pending`，`syncStatus` 扩为：
`'idle' | 'pending' | 'syncing' | 'success' | 'error' | 'warning'`

| 状态 | 触发时机 | 侧栏指示器 |
|------|----------|-----------|
| `idle` | 无待办、已是最新 | 极淡灰点（仅已连接时显示静态点） |
| `pending` 等待同步 | 本地已改、落盘后进入远端上传节流窗口，尚未开始传 | 琥珀点 + 慢呼吸 + 「待同步」 |
| `syncing` 同步中 | 节流到点 / 启动同步 / 周期同步 真正开始执行 | 旋转/脉冲点 + 「同步中」 |
| `success` 已同步 | 上传或下载成功 | 绿色 ✓ + 「已同步」，3s 后淡回 idle |
| `error` 同步失败 | 网络/鉴权/429 重试耗尽 | 红点 + 「同步失败」，**不自动淡出**，点击→打开设置 |
| `warning` 待确认 | 冲突/高危覆盖需用户决定 | 琥珀感叹号 + 「待确认」，点击→打开设置看冲突卡 |

- 新增可复用组件 `SyncStatusIndicator`（provider 无关，读 store 的 `syncStatus`），
  放在**侧栏顶部齿轮（settings-gear）旁**，常驻可见。
- 仅当 `syncProvider !== 'none'`（已配置同步）时显示；未配置不显示，保持本地纯净感。
- `error` / `warning` 时点击 → `setShowSettings(true)` 直达处理；其余状态 hover 出 tooltip
  （含最近一次同步结果/时间）。
- 设置里原有状态点 + 冲突决策卡保留为「详情态」；侧栏指示器是其「常驻精简版」，共用同一 `syncStatus`。
- 状态写入统一在主进程→渲染（`sync-status` 事件）+ store action；`pending` 在进入上传节流窗口时置位，
  `syncing` 在 `enqueueSync` 任务真正开始时置位，串行队列保证状态不打架。

## 9. 错误处理

- 设备码：`authorization_pending` 继续轮询、`slow_down` 加大间隔、`expired_token` 提示重开、
  `access_denied` 提示已取消；超时给出可重试入口。
- token 刷新失败 → 清 token、`onedrive.connected=false`、侧栏/设置提示重连。
- `429` → 读 `Retry-After` 退避；其他网络错误 → `syncStatus='error'`，下个周期重试。
- 冲突 / 高危覆盖 → 维持现有 `needs-confirmation` + 决策卡 + 高危二次确认流程（provider 无关）。
- 远端无快照而本地有有效数据 → 首次上传（现状保留）。

## 10. 可测试性

- reconcile 引擎接收注入的 `RemoteAdapter` → 用内存版 **FakeAdapter** 可完整覆盖决策表。
- 建议顺带引入 **vitest**，针对以下写少量单测（最易出错处）：
  1. reconcile 决策表（remote-newer / diverged / destructive-remote / 首传 / 无变化）。
  2. texts 修复（只有文本框的本地不被判为无意义、能正确触发高危确认）。
  3. 图片差异上传（只传缺失/大小不同者）。
- 是否引入测试设施在实现计划阶段最终确认；若引入，按上面 3 组优先级。

## 11. 实现阶段（供实现计划参考）

1. **抽象层**：定义 `RemoteAdapter`，把现有 webdav 逻辑封进 `WebDAVAdapter`，
   `reconcileWebDAVState` → `reconcileState(adapter)`，IPC 改 `sync-*` + `getActiveAdapter()`。
   —— 阶段验收：坚果云行为零回归。
2. **bug 修复**：texts 纳入摘要、图片差异上传、轮询变更检测 + 退避、远端上传节流。
3. **OneDrive Adapter + 鉴权**：设备码流、token 加密存取与刷新、Graph 文件/图片读写、eTag 条件请求。
4. **设置 schema + 迁移 + provider 选择器 UI + OneDrive 子面板**。
5. **常驻同步状态**：`pending` 状态 + `SyncStatusIndicator` 组件 + 侧栏接入 + 状态机串起来。
6. （可选）vitest 单测。
