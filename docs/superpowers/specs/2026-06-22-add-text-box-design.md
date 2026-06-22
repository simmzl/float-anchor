# 设计文档：画布文本框（Add Text Box）

- 日期：2026-06-22
- 分支：`feat/add-text-box`
- 状态：已批准（方案 A）

## 1. 背景与目标

FloatAnchor 画布上现有三种元素：

- **卡片（Card）**：标题 + 富文本正文，可拖动、可缩放（右下角手柄改宽高），参与分区/连线。
- **标题（CanvasLabel）**：单行 `<input>`，支持 Markdown 标题级别（`#`~`####`，level 0 为 14px 普通文字），定位为横幅式标题。
- **分区（Section）**：彩色容器，可框住一组卡片统一管理。

本功能新增第四种元素：**文本框（TextBox）**——画布上的一段**多行普通正文**。

### 目标（成功标准）

1. 画布空白处右键菜单出现「创建文本」，点击后在点击位置生成一个空文本框并进入编辑态。
2. 文本框为**多行段落文本**：支持换行，普通正文样式（非标题、不加粗）。
3. 视觉**透明、只有文字**——无边框、无背景，文字直接浮在画布上（与标题风格一致）。
4. **宽度可拖拽调整，高度随内容自适应**。
5. 双击进入编辑，`Esc` 或点击外部退出；编辑时**回车为换行**。
6. 可单独拖动、删除。
7. **参与框选（lasso）与群组拖动**——能和卡片/标题/分区一起被框选并整体拖动。
8. 跟随画布数据一起本地持久化，并随坚果云 WebDAV 同步（无需改同步引擎）。

### 非目标（YAGNI）

- 不支持富文本（加粗/列表/链接/图片）。
- 不支持标题级别。
- 不进入分区成员（不被分区框住、不随分区移动）。
- 不参与卡片连线。
- 暂不加顶部工具栏按钮（与「标题」「分区」一致，仅走右键菜单）。
- 不做字号/颜色自定义。

## 2. 方案选择

采用**方案 A：新建一等公民实体 `TextBox`**。

- 新增独立类型、独立数组 `Canvas.texts[]`、独立组件 `TextBoxComponent`，完全镜像 labels/sections 的现有模式。
- 理由：保持标题组件单一职责（单行 input + 标题级别）不被污染；文本框是另一种交互（textarea + 自适应高度 + 正文样式）。边界清晰、可独立测试。
- 代价：在 `labels` 出现的若干集成点各加一份镜像代码，均为机械、低风险改动。

被否方案：B（扩展 CanvasLabel 复用 labels[]）会把单一职责组件改成「两头蛇」；C（复用 Card）最重，会让文本框泄漏进分区/连线逻辑。

## 3. 数据模型（`src/types.ts`）

新增：

```ts
export interface TextBox {
  id: string
  text: string        // 多行纯文本，含换行符
  x: number
  y: number
  width: number       // 可拖拽调整
  height?: number     // 组件测量后回写，供框选/命中判定使用精确几何
  sourceId?: string   // 预留，与其他实体一致
}
```

`Canvas` 接口增加可选字段：

```ts
export interface Canvas {
  // ...existing
  texts?: TextBox[]
}
```

`AppData`、`WebDAVConfig`、同步相关类型**无需改动**。同步引擎按 canvas 整体读写 JSON，`texts` 自动跟随。`WebDAVSyncSummary` / `summarizeSyncData` 暂不把 text 计入实体计数（保持高危拦截阈值语义稳定，避免影响既有同步行为）；此为有意决策，记录在此。

## 4. 状态管理（`src/store.ts`）

镜像 label 的 actions，新增到 `AppState` 接口与实现：

- `addText: (x: number, y: number) => void`
  - 生成 `{ id: uuid(), text: '', x, y, width: 300 }`，追加到当前画布 `texts`，并 `set({ editingTextId: id })` 进入编辑态。
- `updateText: (textId: string, patch: Partial<TextBox>) => void`
- `deleteText: (textId: string) => void`
- `moveText: (textId: string, x: number, y: number) => void`
- 编辑态：复用一个新的 `editingTextId: string | null` 状态（与 `editingCardId` 并列；卡片/标题编辑态互不影响）。

> 说明：标题（CanvasLabel）的编辑态由组件内部 `useState` 管理，没有全局 `editingLabelId`。文本框创建后需要"自动进入编辑"，因此引入全局 `editingTextId`，由 `addText` 置位、组件读取并在退出编辑时清空。这是文本框与标题的一处有意差异。

每个 action 末尾调用 `get().persist()`（与现有一致，触发 600ms 防抖落盘 + WebDAV 自动同步）。

新增 selector（文件底部，镜像 `useActiveLabels`）：

```ts
export function useActiveTexts() {
  return useStore((s) => {
    const c = s.canvases.find((c) => c.id === s.activeCanvasId)
    return c?.texts ?? []
  }, (a, b) => a === b)
}
```

`loadData` 无需改动（`texts` 可选，老数据天然兼容）。

## 5. 组件 `src/components/TextBox.tsx`

参照 `CanvasLabel.tsx` 结构（`React.memo` + 拖动 + 双击编辑 + hover 操作按钮），差异点：

- **渲染（非编辑态）**：`<div className="canvas-text">`，`white-space: pre-wrap; word-break: break-word`，保留换行；正文字号（14px，正常字重）。空文本时显示淡色占位（如「输入文本」）以便点中。
- **编辑态**：`<textarea className="text-edit-input">`，自适应高度（输入时根据 `scrollHeight` 调整），`onChange` 写本地 state；
  - `Enter` = 换行（**不**提交）；
  - `Esc` = 退出编辑（清空 `editingTextId`）；
  - `onBlur` / 点击外部 = 提交（`updateText`，文本可为空——空文本框允许存在还是自动删除见 §7 边界）。
- **进入编辑**：双击；或 hover 出现的"编辑"按钮。组件读取全局 `editingTextId === text.id` 判断是否处于编辑态（使新建后自动聚焦生效）。
- **拖动移动**：复用 CanvasLabel 的 `handleDragStart` 模式（按下非编辑态且未被多选时，按 `scale` 换算位移调用 `moveText`）。被多选时不自己处理拖动，交给 CanvasView 的群组拖动（与 label 一致：`if (selected) return`）。
- **宽度调整**：**右边缘竖直手柄**（仅调宽度，因为高度自适应）；拖拽时按 `scale` 换算更新 `width`（最小宽度约 80px）。
  - 可见性（2026-06-22 验证后修订）：静止时整体仍透明只有文字；**hover 或被框选选中时**才浮现一圈淡轮廓边框 + 右边缘可见的缩放手柄（accent 色竖直小药丸）。早期实现手柄为无背景透明 div、完全不可见导致"找不到地方拖"，此次改为可见抓手。纯 CSS 调整，不改数据模型与逻辑。
- **高度回写**：用 `ResizeObserver` 观察渲染容器实际高度，与 `text.height` 不同（容差 1px）时 `updateText(id, { height })`。保证 §6 的框选/命中几何精确。
- **hover 操作**：编辑、删除两个小按钮（镜像 label）。

Props：`{ text: TextBox; scale: number; selected?: boolean }`。

## 6. 画布集成（`src/components/CanvasView.tsx`）

在 `labels` 出现的每个位置加 `texts` 的镜像分支：

1. **import**：引入 `TextBox` 组件与类型，`useActiveTexts`。
2. **选择集类型**：`SelectionSet` 增加 `textIds: Set<string>`；`emptySelection()` 加 `textIds: new Set()`；`selectionEmpty()` 增加 `&& sel.textIds.size === 0`。
3. **`computeSelection`**：增加 `texts: TextBox[]` 参数，遍历 texts 用 `rectsIntersect` 命中（高度用 `text.height ?? 24` 兜底）写入 `sel.textIds`。调用处传入当前 `texts`。
4. **按下命中判定**（约 line 403–442）：在 label 命中循环后加一段 texts 循环，命中已选中的文本框则进入群组拖动；用 `text.height ?? 24` 作为命中高度。
5. **群组拖动 effect**（约 line 480–616）：
   - 新增 `origTexts = new Map<string,{x,y}>()`，从 `canvas0.texts ?? []` 填充被选中项。
   - 「无卡片选中」分支：加 `updatedTexts`（按 `totalDx/totalDy` 平移），写回 `texts`。
   - 主分支：加 `updatedTexts`（按 `finalDx/finalDy` 平移），写回 `texts`。
   - effect 依赖 `[isMultiDragging, selection]` 不变。
6. **空白处右键菜单**（约 line 750–766）：在「创建标题」后插入一项 `{ label: '创建文本', icon: ..., onClick: () => addText(coords.x, coords.y) }`；`addText` 从 store 取并加入 `useCallback` 依赖。
7. **渲染**（约 line 952）：在 labels 渲染块旁加 `texts.map((t) => <TextBoxComponent key={t.id} text={t} scale={scaleVal.current} selected={selection.textIds.has(t.id)} />)`。
8. **`.closest` 判定**（约 line 444）：把 `.canvas-text` 加入"点中元素则不触发空白逻辑/不开套索"的判定，避免在文本框上按下时误开框选。

> 删除快捷键：现有键盘处理（约 line 620）未对多选元素做批量删除（仅 Esc 清空选择、Backspace 取消连线）。文本框删除走 hover 删除按钮即可，保持与 label 当前行为一致；不在本次扩大删除快捷键范围。

## 7. 边界与细节

- **空文本框**：编辑提交时若内容为空——采用「保留空框」策略（不自动删除），与卡片新建后可为空一致；用户可通过删除按钮移除。（备选：空则自动删除，类似 label commit 时 trim 为空则不更新。最终取保留空框，避免新建后点空白即消失的困惑。）
- **新建即编辑**：`addText` 置 `editingTextId`，组件挂载时若命中则聚焦 textarea。
- **缩放换算**：拖动/改宽/位移一律除以 `scale`，与 label/card 现有处理一致。
- **高度兜底**：`height` 未测量时，框选与命中用 `24`（约一行）兜底；测量后回写精确值。
- **老数据兼容**：`texts` 为 `undefined` 时全部按空数组处理。
- **多选拖动 + 自适应高度**：群组拖动只改 `x/y`，不触发高度变化，无冲突。

## 8. 验证（手动 + 类型/构建）

无既有自动化测试框架（仓库无测试配置），以**手动验证 + `npm run build` 类型检查**为准：

1. `npm run build` 通过（`tsc` 无类型错误）。
2. `npm run dev` 启动，画布空白右键 → 「创建文本」→ 出现可编辑文本框，输入多行文本、回车换行正常。
3. 退出编辑（Esc / 点外部），文字以 pre-wrap 多行显示，无边框背景。
4. 拖动文本框移动；拖右边手柄改宽度，文字重排、高度自适应。
5. 双击重新编辑；hover 删除按钮可删除。
6. 框选把文本框与卡片/标题一起选中，群组拖动整体移动。
7. 切换画布、重启应用后文本框持久化保留。
8. （可选）配置坚果云后，文本框改动随同步上传/下载。

## 9. 受影响文件清单

- `src/types.ts`：新增 `TextBox`，`Canvas.texts?`。
- `src/store.ts`：`editingTextId` 状态、`addText/updateText/deleteText/moveText`、`useActiveTexts`。
- `src/components/TextBox.tsx`：新增组件。
- `src/components/CanvasView.tsx`：选择集 / computeSelection / 命中判定 / 群组拖动 / 右键菜单 / 渲染 / `.closest` 共 8 处镜像接线。
- `src/index.css`：`.canvas-text`、`.text-edit-input`、宽度手柄、hover 操作等样式。
