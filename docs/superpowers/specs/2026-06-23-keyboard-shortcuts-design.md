# 设计文档：画布快捷键（轻量层）Keyboard Shortcuts

- 日期：2026-06-23
- 分支：`feat/add-text-box`（继续在同分支累积；文本框 + 自动排布尚未合并）
- 状态：已批准键位表（待 spec 复审）

## 1. 背景与目标

当前 app 几乎没有画布快捷键：仅全局 `Esc`（清选区/取消连线）、`Backspace`（仅取消连线）；编辑态各输入框有 Esc/Enter。创建走双击/右键菜单，删除走 hover 垃圾桶，没有全选、没有撤销/重做、没有复制粘贴。

本功能新增一套**轻量层**快捷键——全部映射到**现有操作**（或少量原子封装），不引入历史栈/剪贴板，低风险、即用。

### 目标（成功标准）
1. 下表快捷键全部生效，Mac/Win 修饰键自适应。
2. 在文字编辑态（输入框/textarea/富文本聚焦，或正在编辑某卡片/文本）时，全局快捷键**全部不触发**。
3. 不破坏现有 Esc/连线/框选/群组拖动行为。

### 非目标（YAGNI）
- 不做撤销/重做（无历史栈）、复制/粘贴/再制（无对象剪贴板）。
- 不做 `?` 快捷键速查面板。
- 不为标题/分区做"Enter 进入编辑"（它们无全局编辑态）。

## 2. 键位表（已批准）

`Mod` = Mac `⌘` / Win `Ctrl`（沿用现有 `e.metaKey || e.ctrlKey`）。

| 操作 | 键位 | 行为 |
|---|---|---|
| 新建卡片 | `C` | 在视口中心创建卡片并进入编辑 |
| 新建文本框 | `T` | 视口中心创建文本框并进入编辑 |
| 新建分区 | `R` | 视口中心创建分区 |
| 全选 | `Mod+A` | 选中当前画布所有 卡片/标题/分区/文本框 |
| 取消选择 / 退出连线 | `Esc` | 现有行为，保留 |
| 编辑选中 | `Enter` | 仅当**恰好单选一个卡片或文本框**时进入其编辑态 |
| 删除选中 | `Delete` / `Backspace` | 删除所有选中元素（见 §6 语义）；连线模式下 `Backspace` 仍为取消连线 |
| 自动排布选中 | `Mod+Shift+A` | 选中可排布单位 ≥2 时调用 `arrangeUnits`（复用既有功能） |
| 微移选中 | `方向键` | 移 1px；`Shift+方向键` 移 10px |
| 放大 / 缩小 | `Mod+=` / `Mod+-` | 以视口中心缩放（含 `Mod++` 同放大） |
| 缩放复位 | `Mod+0` | 回到 100%，以视口中心为锚 |

## 3. 贯穿规则

- **编辑态禁用（核心）**：进入快捷键分发前先判断"是否处于文字输入上下文"，是则**直接 return**（不拦截、让浏览器/编辑器处理）。判定 = `document.activeElement` 的 tagName 为 `INPUT`/`TEXTAREA`，或其 `isContentEditable` 为真（TipTap 富文本），或 store 的 `editingCardId`/`editingTextId` 非空。
- **Mod 自适应**：`const mod = e.metaKey || e.ctrlKey`。
- **必要时 `preventDefault`**：`Mod+A`（防浏览器全选）、`Mod+=/-/0`（防浏览器缩放）、方向键（防页面滚动）、`Delete/Backspace`（防 Win 上退到上一页）。单字母 C/T/R 不必。
- **删除分区语义**：见 §6（与右键垃圾桶的"保留卡片"语义**不同**，本表 Delete 删除全部高亮选中）。

## 4. 架构

### 4.1 Store 新增两个原子 action（`src/store.ts`）
镜像 `arrangeUnits` 的写法（一次 `set` + `persist`）：

```ts
deleteUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }) => void
nudgeUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }, dx: number, dy: number) => void
```

- `deleteUnits`：在活动画布上，从 `cards` 删除 `cardIds`、`labels` 删 `labelIds`、`sections` 删 `sectionIds`、`texts` 删 `textIds`；并把被删卡片从所有 `section.cardIds` 成员列表中剔除（保持成员引用一致）。同时若 `editingCardId`/`editingTextId` 指向被删元素则清空。一次 `set` + `persist`。
- `nudgeUnits`：把所有选中元素（cards∈cardIds / labels∈labelIds / sections∈sectionIds / texts∈textIds）的 `x,y` 各 `+dx/+dy`。**无需分区特殊处理**——框选/全选时分区成员已在 `cardIds` 中，随之平移（与现有群组拖动语义一致：均匀平移所有选中 id）。一次 `set` + `persist`。

> 不复用现有单个 `deleteCard/moveCard` 等逐个调用：那会多次 `set`+`persist` 且 `moveCard` 带磁吸，不适合精确 1px 微移。原子 action 更干净。

### 4.2 CanvasView 全局键盘分发（`src/components/CanvasView.tsx`）
在现有全局 `keydown` useEffect（约 line 662，处理 Esc/Backspace-连线）中**扩展**为完整快捷键分发；不新开第二个 document 级监听，避免顺序/重复。结构：

```
onKey(e):
  1. 若处于编辑输入上下文 → return（见 §3）
  2. 现有：Esc（取消连线/清选区）、Backspace+connectingFrom（取消连线）—— 保留并优先
  3. mod = e.metaKey || e.ctrlKey；k = e.key.toLowerCase()（字母统一小写比较——
     按住 Shift 时 e.key 会变大写，必须 toLowerCase 后再用 e.shiftKey 区分）
  4. 分发（字母分支一律用 k）：
     - mod && shift && k==='a' → preventDefault; arrangeUnits(选区)（≥2 才有效，store 内已兜底）
     - mod && !shift && k==='a' → preventDefault; 全选
     - mod && (key==='=' || '+') → preventDefault; zoomAroundCenter(1.1)
     - mod && key==='-'      → preventDefault; zoomAroundCenter(1/1.1)
     - mod && key==='0'      → preventDefault; resetZoomAroundCenter()
     - 非 mod（且非 shift 修饰的字母）：
        - k==='c'            → 视口中心 addCard
        - k==='t'            → 视口中心 addText
        - k==='r'            → 视口中心 addSection
        - e.key==='Enter'    → 若恰好单选 1 个卡片/文本 → 进入编辑
        - e.key 为 'Delete'/'Backspace' 且选区非空 → preventDefault; deleteUnits(选区); 清选区
        - e.key 为方向键且选区非空 → preventDefault; nudgeUnits(选区, ±step,0 / 0,±step)，step = e.shiftKey?10:1
```

依赖：该 effect 需把用到的 `selection/setSelection/cards/labels/sections/texts/store actions/连线状态/视口 helper` 纳入依赖数组（按实际补齐）。

### 4.3 视口 helper（CanvasView 内，复用现有机制）
- `viewportCenterCanvasCoords()`：用 `viewportRef.getBoundingClientRect()` 取中心屏幕坐标，经 `toCanvasCoords` 转画布坐标。创建时让元素**大致居中**：`addCard` 传 `cx - 186`（373/2）、`cy - 40`；`addText` 传 `cx - 150`（300/2）、`cy - 20`；`addSection` 传 `cx - 300`（600/2）、`cy - 200`（400/2）。
- `zoomAroundCenter(factor)`：以视口中心为锚，按现有滚轮缩放同款公式更新 `pan/scaleVal` 并 `applyTransform()` + `scheduleCull()`：
  ```
  const rect = viewportRef.current.getBoundingClientRect()
  const cx = rect.width/2, cy = rect.height/2
  const s = scaleVal.current, ns = clamp(s*factor, MIN_SCALE, MAX_SCALE), ratio = ns/s
  pan.current = { x: Math.round(cx - (cx - pan.current.x)*ratio), y: Math.round(cy - (cy - pan.current.y)*ratio) }
  scaleVal.current = ns; applyTransform(); scheduleCull()
  ```
- `resetZoomAroundCenter()`：同上但 `ns = 1`（`ratio = 1/s`）。

### 4.4 全选 helper
构造完整 `SelectionSet`：当前画布所有 `cards/labels/sections/texts` 的 id 放入对应 Set，`setSelection(...)`。（分区成员卡片本就在全部 cards 里，天然包含。）

> 架构取舍：键盘分发与视口 refs/选区 state 深度耦合于 CanvasView，故**就地扩展现有 keydown effect**，不抽独立 hook（抽出需透传 ~15 个 refs/回调，反而更糟）。CanvasView 已较大，但本功能与既有 keydown/viewport 逻辑同源，留在此处内聚最佳。

## 5. 各快捷键行为细节
- **C/T/R 创建**：复用 `addCard/addText/addSection`，位置为视口中心（§4.3）。`addCard/addText` 内部已置 `editingCardId/editingTextId`（自动进入编辑）；`addSection` 不进编辑（与现状一致）。
- **Mod+A 全选**：§4.4。再次说明 Enter/Delete 等随后可作用于全选结果。
- **Enter 编辑**：仅当 `cardIds.size + labelIds.size + sectionIds.size + textIds.size === 1`。若该 1 个是卡片→`setEditingCard(id)`；是文本→`setEditingText(id)`；是标题/分区→不处理（无全局编辑态）。
- **Delete/Backspace 删除**：选区非空才动作；§6 语义；删后 `setSelection(empty)`。连线模式优先（`connectingFrom` 时 Backspace 走取消连线分支）。
- **Mod+Shift+A 自动排布**：调 `arrangeUnits([...各 Set])`；store 内 `units<2` 兜底为 no-op。
- **方向键微移**：`nudgeUnits(选区, dx, dy)`，`↑↓←→` 对应 `(0,-s)/(0,+s)/(-s,0)/(+s,0)`，`s = e.shiftKey ? 10 : 1`。
- **缩放**：§4.3，clamp 到 `MIN_SCALE/MAX_SCALE`。

## 6. ⚠️ 关键语义 + 边界（请 spec 复审重点确认）
- **删除语义（需你确认）**：本设计 `Delete/Backspace` 删除**所有当前高亮选中**的元素——包括因框选/全选而被选中（并显示蓝色描边）的**分区内成员卡片**。即"所见高亮即所删"。这与**右键垃圾桶删单个分区时"保留内部卡片"的语义不同**（那条保留不变）。若你希望键盘删除也"删分区留卡片"，告诉我改。
- **⚠️ 无撤销风险**：当前 app **没有撤销/重做**。键盘批量删除一旦误触即永久（与现有垃圾桶一致，但键盘更易批量）。本轮不引入撤销（属非目标）。可接受则保留；否则可选择不把 Delete 纳入键盘（其余照旧）。
- **创建位置**：视口中心（键盘无鼠标位置）。
- **缩放锚点**：视口中心（非鼠标）。
- **老数据兼容**：所有集合 `?? []`。
- **不影响**：组件内编辑态的 Esc/Enter（被 §3 编辑态禁用规则挡在全局分发之外）。

## 7. 验证
项目无测试框架，门禁 `npx tsc -p tsconfig.json`（noEmit）+ `npm run build`，外加手动验证：
1. tsc、build 通过。
2. 非编辑态：`C/T/R` 在视口中心建卡片/文本/分区（卡片、文本自动进入编辑）。
3. 编辑某卡片/文本时按 `C/T/R/Delete/方向键` → 只是正常输入字符/移动光标，**不触发**全局操作。
4. `Mod+A` 全选；`Mod+Shift+A` 把选中整理成紧凑列；`Esc` 清选。
5. 框选若干 → `Delete` 全部删除；`方向键`/`Shift+方向键` 以 1/10px 微移。
6. 单选一个卡片 → `Enter` 进入编辑。
7. `Mod+=`/`Mod+-`/`Mod+0` 以视口中心缩放/复位，右下角缩放百分比同步。
8. 现有框选、群组拖动、连线、Esc 行为无回归。

## 8. 受影响文件
- `src/store.ts`：`AppState` 新增 `deleteUnits`、`nudgeUnits` 声明 + 实现。
- `src/components/CanvasView.tsx`：扩展全局 keydown effect；新增 `viewportCenterCanvasCoords`/`zoomAroundCenter`/`resetZoomAroundCenter`/全选 helper；接入 store 的 `deleteUnits/nudgeUnits/arrangeUnits` 等 hook 与依赖。
- （无新类型、无 CSS。）
