# 设计文档：多选自动排布（Auto-Arrange Selection）

- 日期：2026-06-23
- 分支：`feat/add-text-box`（文本框功能尚未合并，本功能依赖其多选基建，继续在同分支上做）
- 状态：已批准（方案 A）

## 1. 背景与目标

画布支持框选（lasso）多选卡片 / 标题 / 分区 / 文本框，并能群组拖动。但选中的一组单位若位置高低不齐、间距不均（例如把一个大文本框拆成 28 个小框后散落各处），目前只能逐个手动拖整齐。

本功能：**选中 ≥2 个单位后，右键选区弹出「自动排布」，点击即把这些单位紧凑分列、就地拉齐拉紧。**

### 目标（成功标准）

1. 当画布上有 ≥2 个可排布单位被选中、且右键落在某个选中元素上时，右键菜单出现**「自动排布」**项。
2. 点击「自动排布」后，选中单位按**紧凑分列**重新排列：保留它们大致的列结构（按当前中心 x 聚类成列），列内按上下顺序、等间距紧凑堆叠（各单位高度不同也不重叠），列与列对齐。
3. **就地排布**：整体锚定在选区当前的左上角 `(minX, minY)`，不会把内容甩到别处。
4. **分区当整块**：分区按其整体足迹算一个单位参与排列；移动分区时其内部成员卡片随之同向位移；已在选中分区内的成员卡片不再单独参与排列（避免重复移动）。
5. 文本框 / 卡片 / 标题 / 分区都可参与（任意混选）。
6. 排布后选区保持不变，可连续微调或再排。
7. 改动随 `persist()` 落盘，并随既有 WebDAV 同步（无需改同步引擎）。

### 非目标（YAGNI）

- 不做对齐线 / 分布对齐（左对齐、垂直等距分布等高级排版）。
- 不做动画过渡。
- 不加快捷键。
- 不搬用 `compactSection` 的「连线锁定」与「撑大分区」逻辑——通用排布只拉齐拉紧选中单位，不动分区尺寸、不为连线特殊处理。
- 不改数据模型 / 类型（纯行为新增）。

## 2. 方案选择

采用**方案 A**：新增 store action `arrangeUnits`，把现有 `compactSection`（store.ts，分区内卡片的列聚类紧凑布局）的核心算法**泛化**为对任意选中单位集合生效；右键菜单在 `handleContextMenu` 最前面新增「多选选区」分支。

- 理由：复用经过验证的列聚类 + 紧凑堆叠算法；排布逻辑收敛在 store、一次 `set` 原子更新；组件只负责弹菜单。保持单一职责，不污染 `compactSection`（分区专属逻辑保留原样）。
- 被否：B（在组件里算、逐个调 update）非原子、组件变重；C（直接扩 `compactSection`）会把分区专属逻辑与通用排布纠缠。

## 3. 数据模型

**无变更。** 复用现有 `Card / CanvasLabel / Section / TextBox`。本功能只读取并重写它们的 `x/y`（分区附带移动其成员卡片的 `x/y`）。

## 4. 算法（新 store action `arrangeUnits`）

### 4.1 接口

```ts
// AppState 接口新增：
arrangeUnits: (ids: {
  cardIds: string[]
  labelIds: string[]
  sectionIds: string[]
  textIds: string[]
}) => void
```

CanvasView 调用时把选择集的 `Set` 转数组传入：
`arrangeUnits({ cardIds: [...selection.cardIds], labelIds: [...selection.labelIds], sectionIds: [...selection.sectionIds], textIds: [...selection.textIds] })`

### 4.2 单位收集（rect）

在当前活动画布上，把选中项收成"单位"矩形 `{ id, kind, x, y, w, h }`：

- 选中文本框（`textIds`）：`{kind:'text', x, y, w: width, h: height ?? 24}`
- 选中标题（`labelIds`）：`{kind:'label', x, y, w: width, h: 40}`
- 选中分区（`sectionIds`）：`{kind:'section', x, y, w: width, h: height}`
- 选中卡片（`cardIds`）中**不属于任何选中分区**的：`{kind:'card', x, y, w: width, h: height ?? 200}`
  - "属于某选中分区"= 该 card.id ∈ 某个 `sectionIds` 对应分区的 `cardIds`。这些卡片排除在单位之外，仅随分区位移。

设单位总数为 `N`。**若 `N < 2` 直接返回（no-op）。**

### 4.3 列聚类 + 紧凑堆叠（复用 `compactSection` 思路，去掉锁定/撑大）

```
GAP = 20
byX = units 按 x 升序
columns = []                       // 每列是 unit[]
for r in byX:
  cx = r.x + r.w/2
  找一个已存在列 col 使 |cx - (col[0].x + col[0].w/2)| < max(r.w, col[0].w) * 0.6
  命中则 col.push(r)，否则新建列 [r]
for col in columns: col 按 y 升序
columns 按各列平均 x 升序

originX = min(u.x for u in units)
originY = min(u.y for u in units)
newPos = {}                        // id -> {x, y}
colX = originX
for col in columns:
  colW = max(u.w for u in col)
  cy = originY
  for u in col:                    // 已按 y 升序
    newPos[u.id] = { x: round(colX), y: round(cy) }
    cy += u.h + GAP
  colX += colW + GAP
```

结果：选中单位被拉成左上角锚定 `(originX, originY)` 的若干对齐列，列内等间距紧凑、不重叠。

### 4.4 应用（一次 `set` 原子写回）

- 先为每个选中分区算位移：`delta(sectionId) = newPos[sectionId] - (section.x, section.y)`。
- 在 `canvases.map` 中对活动画布：
  - `texts`：`id ∈ newPos` → 用 `newPos`；否则不变。
  - `labels`：同上。
  - `sections`：`id ∈ newPos` → 用 `newPos`；否则不变。
  - `cards`：
    - 若该卡片是某选中分区的成员 → `x += delta.x, y += delta.y`（用该分区的 delta）；
    - 否则若 `id ∈ newPos`（独立卡片单位）→ 用 `newPos`；
    - 否则不变。
  - （每张卡片三者互斥：成员卡片已被排除在单位外，不会同时 ∈ newPos。）
  - （不变式：`loadData` 已对分区成员去重，每张卡片至多属于 1 个分区，故"该分区的 delta"无歧义。）
- 末尾 `get().persist()`（沿用既有节流落盘 + WebDAV 自动同步）。

## 5. 右键菜单接入（`src/components/CanvasView.tsx`）

### 5.1 复用的命中判定（抽成模块级 helper，DRY）

把 `handleMouseDown` 里现有的"点是否落在某个选中元素上"的内联判定抽成模块级纯函数，供 `handleMouseDown` 与 `handleContextMenu` 共用（消除重复）：

```ts
function pointInSelection(
  coords: { x: number; y: number },
  sel: SelectionSet,
  cards: Card[], labels: CanvasLabel[], sections: Section[], texts: TextBox[],
): boolean {
  for (const id of sel.cardIds) { const c = cards.find(x => x.id === id); if (c && coords.x >= c.x && coords.x <= c.x + c.width && coords.y >= c.y && coords.y <= c.y + (c.height ?? 200)) return true }
  for (const id of sel.labelIds) { const l = labels.find(x => x.id === id); if (l && coords.x >= l.x && coords.x <= l.x + l.width && coords.y >= l.y && coords.y <= l.y + 40) return true }
  for (const id of sel.sectionIds) { const s = sections.find(x => x.id === id); if (s && coords.x >= s.x && coords.x <= s.x + s.width && coords.y >= s.y && coords.y <= s.y + s.height) return true }
  for (const id of sel.textIds) { const t = texts.find(x => x.id === id); if (t && coords.x >= t.x && coords.x <= t.x + t.width && coords.y >= t.y && coords.y <= t.y + (t.height ?? 24)) return true }
  return false
}
```

`handleMouseDown` 中原先内联的多块 `if (!hitSelected) { for ... }` 命中判定改为 `if (pointInSelection(coords, selection, cards, labels, sections, texts)) hitSelected = true`（行为等价，仅去重）。

### 5.2 可排布单位计数

```ts
function arrangeableUnitCount(
  sel: SelectionSet, sections: Section[],
): number {
  const memberOfSelected = new Set<string>()
  for (const sid of sel.sectionIds) {
    const s = sections.find(x => x.id === sid)
    for (const cid of (s?.cardIds ?? [])) memberOfSelected.add(cid)
  }
  let cards = 0
  for (const cid of sel.cardIds) if (!memberOfSelected.has(cid)) cards++
  return sel.textIds.size + sel.labelIds.size + sel.sectionIds.size + cards
}
```

（注意：框选一个分区会把其成员卡片也加进 `cardIds`，所以不能直接用各 Set 的 size 之和——需按 4.2 的口径排除选中分区的成员卡片，避免"只选了 1 个分区"被误判为多单位。）

### 5.3 菜单分支

在 `handleContextMenu` 的现有守卫（`rightDragged` / `connectingFrom`）之后、`noteCard` 分支**之前**插入：

```ts
const coords = toCanvasCoords(e.clientX, e.clientY)
if (arrangeableUnitCount(selection, sections) >= 2 && pointInSelection(coords, selection, cards, labels, sections, texts)) {
  setCtxMenu({
    x: e.clientX,
    y: e.clientY,
    items: [{
      label: '自动排布',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
      onClick: () => arrangeUnits({
        cardIds: [...selection.cardIds],
        labelIds: [...selection.labelIds],
        sectionIds: [...selection.sectionIds],
        textIds: [...selection.textIds],
      }),
    }],
  })
  return
}
```

并新增 hook `const arrangeUnits = useStore((s) => s.arrangeUnits)`；把 `arrangeUnits`、`texts`、`labels`、`sections`、`cards`、`selection`、`toCanvasCoords` 纳入 `handleContextMenu` 的 `useCallback` 依赖（按实际缺项补齐）。

## 6. 触发与边界

- 「自动排布」仅在 `arrangeableUnitCount ≥ 2` 且右键落在选中元素上时出现；否则走原有菜单（卡片 / 分区 / 空白），行为不变。
- `arrangeUnits` 内部对 `N < 2` 再次兜底为 no-op。
- 排布后不修改 `selection`（选区保持，便于连续操作）。
- 不与现有 `compactSection`（分区内卡片）冲突——那是分区右键的独立功能，保留原样。
- 老数据兼容：所有集合 `?? []`，高度兜底见 4.2。

## 7. 验证

项目无测试框架，门禁为 `npx tsc -p tsconfig.json`（`noEmit`）+ `npm run build`，外加手动验证：

1. `npx tsc -p tsconfig.json` 通过；`npm run build` 通过。
2. 框选多个散落文本框 → 右键选区 → 出现「自动排布」→ 点击 → 它们被拉成对齐的紧凑列，整体仍在原区域左上角，无重叠。
3. 框选含 1 个分区 + 几个文本框/卡片 → 自动排布 → 分区作为整块参与排列，其内部卡片随分区一起移动，相对位置不变。
4. 只选 1 个单位（或只选 1 个分区）→ 右键**不**出现「自动排布」。
5. 右键落在空白处 / 非选中元素 → 出现原有菜单，行为不变。
6. 排布后选区描边仍在；可再次右键自动排布或群组拖动。
7. 重启 app 后排布结果持久化保留。

## 8. 受影响文件

- `src/store.ts`：`AppState` 新增 `arrangeUnits` 声明 + 实现（§4）。
- `src/components/CanvasView.tsx`：新增模块级 helper `pointInSelection`、`arrangeableUnitCount`（§5.1/5.2）；`handleMouseDown` 内联命中判定改用 `pointInSelection`（去重）；`handleContextMenu` 新增选区分支（§5.3）+ `arrangeUnits` hook + 依赖补齐。
- （无 CSS、无类型改动。）
