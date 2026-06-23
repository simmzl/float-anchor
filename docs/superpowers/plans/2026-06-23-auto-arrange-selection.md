# 多选自动排布（Auto-Arrange Selection）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选中 ≥2 个画布单位（文本框/卡片/标题/分区）后，右键选区弹出「自动排布」，点击把它们紧凑分列、就地拉齐拉紧。

**Architecture:** 方案 A —— 新增 store action `arrangeUnits`，把现有 `compactSection` 的「按中心 x 聚类成列 → 列内按 y 紧凑堆叠 → 列间对齐」算法泛化到任意选中单位集合；`CanvasView` 在 `handleContextMenu` 最前面加「选区分支」弹出菜单，并把"点是否落在选中元素上"的判定抽成模块级 `pointInSelection` 供 `handleMouseDown` 与 `handleContextMenu` 共用。

**Tech Stack:** React 18 + TypeScript + Zustand + Electron。

## Global Constraints

- 排布样式：**紧凑分列**，按中心 x 聚类成列、列内按 y 升序等间距堆叠（各单位高度不同也不重叠）、列间对齐；`GAP = 20`。
- **就地排布**：整体锚定在选区当前 `(minX, minY)`，不移到别处。
- **分区当整块**：分区按足迹算一个单位参与；分区移动时其成员卡片随同向位移；已在选中分区内的成员卡片不单独参与排列。
- 适用单位：文本框 / 卡片 / 标题 / 分区（任意混选）。
- 触发：可排布单位数 ≥2 且右键落在某个选中元素上时才显示「自动排布」；否则走原菜单，行为不变。排布后不改 `selection`。
- 不搬用 `compactSection` 的连线锁定 / 撑大分区逻辑；不改数据模型 / 类型；不加 CSS。
- 不变式：`loadData` 已对分区成员去重，每张卡片至多属于 1 个分区。
- 项目无测试框架，门禁为 `npx tsc -p tsconfig.json`（`tsconfig.json` 已配 `noEmit: true`，纯检查不产物）；Task 2 另跑 `npm run build` + 手动验证。`node_modules` 已安装。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 这是 Electron 桌面 GUI 应用，subagent 无法 headless 驱动 GUI 交互；手动验证留到收尾由人执行，**不要**因跑不了 GUI 而报 BLOCKED。

---

### Task 1: store action `arrangeUnits`

**Files:**
- Modify: `src/store.ts`（`AppState` 接口新增 `arrangeUnits` 声明；实现插在 `compactSection` 实现之后、`addConnection` 之前）

**Interfaces:**
- Consumes：现有类型 `Card / CanvasLabel / Section / TextBox`（已在 store.ts 导入）；`get()/set()/persist()`。
- Produces：store action
  `arrangeUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }) => void`

- [ ] **Step 1: 在 `AppState` 接口声明 `arrangeUnits`**

在 `compactSection: (sectionId: string) => void`（约第 52 行）下一行增加：

```ts
  arrangeUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }) => void
```

- [ ] **Step 2: 实现 `arrangeUnits`**

在 `compactSection` 实现的闭合 `},`（约第 851 行，紧接其后是 `addConnection:`）之前插入完整实现：

```ts
  arrangeUnits: (ids) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    const canvas = get().canvases.find((c) => c.id === activeCanvasId)
    if (!canvas) return

    const cardIds = new Set(ids.cardIds)
    const labelIds = new Set(ids.labelIds)
    const sectionIds = new Set(ids.sectionIds)
    const textIds = new Set(ids.textIds)

    const selSections = (canvas.sections ?? []).filter((s) => sectionIds.has(s.id))
    const memberOfSelected = new Set<string>()
    for (const s of selSections) {
      for (const cid of (s.cardIds ?? [])) memberOfSelected.add(cid)
    }

    type Unit = { id: string; x: number; y: number; w: number; h: number }
    const units: Unit[] = []
    for (const t of canvas.texts ?? []) {
      if (textIds.has(t.id)) units.push({ id: t.id, x: t.x, y: t.y, w: t.width, h: t.height ?? 24 })
    }
    for (const l of canvas.labels ?? []) {
      if (labelIds.has(l.id)) units.push({ id: l.id, x: l.x, y: l.y, w: l.width, h: 40 })
    }
    for (const s of canvas.sections ?? []) {
      if (sectionIds.has(s.id)) units.push({ id: s.id, x: s.x, y: s.y, w: s.width, h: s.height })
    }
    for (const c of canvas.cards) {
      if (cardIds.has(c.id) && !memberOfSelected.has(c.id)) {
        units.push({ id: c.id, x: c.x, y: c.y, w: c.width, h: c.height ?? 200 })
      }
    }

    if (units.length < 2) return

    const GAP = 20

    // 列聚类（按中心 x），复用 compactSection 思路
    const byX = [...units].sort((a, b) => a.x - b.x)
    const columns: Unit[][] = []
    for (const r of byX) {
      const cx = r.x + r.w / 2
      let placed = false
      for (const col of columns) {
        const colCx = col[0].x + col[0].w / 2
        if (Math.abs(cx - colCx) < Math.max(r.w, col[0].w) * 0.6) {
          col.push(r); placed = true; break
        }
      }
      if (!placed) columns.push([r])
    }
    for (const col of columns) col.sort((a, b) => a.y - b.y)
    columns.sort((a, b) => {
      const ma = a.reduce((s, r) => s + r.x, 0) / a.length
      const mb = b.reduce((s, r) => s + r.x, 0) / b.length
      return ma - mb
    })

    const originX = Math.min(...units.map((u) => u.x))
    const originY = Math.min(...units.map((u) => u.y))
    const newPos = new Map<string, { x: number; y: number }>()
    let colX = originX
    for (const col of columns) {
      const colW = Math.max(...col.map((u) => u.w))
      let cy = originY
      for (const u of col) {
        newPos.set(u.id, { x: Math.round(colX), y: Math.round(cy) })
        cy += u.h + GAP
      }
      colX += colW + GAP
    }

    // 分区位移 + 成员卡片归属
    const sectionDelta = new Map<string, { dx: number; dy: number }>()
    for (const s of selSections) {
      const np = newPos.get(s.id)
      if (np) sectionDelta.set(s.id, { dx: np.x - s.x, dy: np.y - s.y })
    }
    const cardToSection = new Map<string, string>()
    for (const s of selSections) {
      for (const cid of (s.cardIds ?? [])) cardToSection.set(cid, s.id)
    }

    set((st) => ({
      canvases: st.canvases.map((c) => {
        if (c.id !== activeCanvasId) return c
        return {
          ...c,
          texts: (c.texts ?? []).map((t) => {
            const np = newPos.get(t.id)
            return np ? { ...t, x: np.x, y: np.y } : t
          }),
          labels: (c.labels ?? []).map((l) => {
            const np = newPos.get(l.id)
            return np ? { ...l, x: np.x, y: np.y } : l
          }),
          sections: (c.sections ?? []).map((s) => {
            const np = newPos.get(s.id)
            return np ? { ...s, x: np.x, y: np.y } : s
          }),
          cards: c.cards.map((cd) => {
            const secId = cardToSection.get(cd.id)
            if (secId) {
              const d = sectionDelta.get(secId)
              return d ? { ...cd, x: cd.x + d.dx, y: cd.y + d.dy } : cd
            }
            const np = newPos.get(cd.id)
            return np ? { ...cd, x: np.x, y: np.y } : cd
          }),
        }
      }),
    }))
    get().persist()
  },
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

- [ ] **Step 4: Commit**

```bash
git add src/store.ts
git commit -m "$(cat <<'EOF'
feat: 新增 arrangeUnits —— 选中单位紧凑分列排布

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 画布右键接入「自动排布」

**Files:**
- Modify: `src/components/CanvasView.tsx`（模块级 helper `pointInSelection` / `arrangeableUnitCount`；`handleMouseDown` 命中判定改用 helper；`handleContextMenu` 加选区分支 + `arrangeUnits` hook + 依赖补齐）

**Interfaces:**
- Consumes（来自 Task 1）：`useStore` 的 `arrangeUnits`。
- Produces：模块级函数 `pointInSelection(coords, sel, cards, labels, sections, texts): boolean`、`arrangeableUnitCount(sel, sections): number`。

- [ ] **Step 1: 新增模块级 helper**

在 `computeSelection` 函数闭合 `}`（约第 75 行）之后插入：

```ts
function pointInSelection(
  coords: { x: number; y: number },
  sel: SelectionSet,
  cards: Card[],
  labels: CanvasLabel[],
  sections: Section[],
  texts: TextBox[],
): boolean {
  for (const id of sel.cardIds) {
    const c = cards.find((x) => x.id === id)
    if (c && coords.x >= c.x && coords.x <= c.x + c.width &&
        coords.y >= c.y && coords.y <= c.y + (c.height ?? 200)) return true
  }
  for (const id of sel.labelIds) {
    const l = labels.find((x) => x.id === id)
    if (l && coords.x >= l.x && coords.x <= l.x + l.width &&
        coords.y >= l.y && coords.y <= l.y + 40) return true
  }
  for (const id of sel.sectionIds) {
    const s = sections.find((x) => x.id === id)
    if (s && coords.x >= s.x && coords.x <= s.x + s.width &&
        coords.y >= s.y && coords.y <= s.y + s.height) return true
  }
  for (const id of sel.textIds) {
    const t = texts.find((x) => x.id === id)
    if (t && coords.x >= t.x && coords.x <= t.x + t.width &&
        coords.y >= t.y && coords.y <= t.y + (t.height ?? 24)) return true
  }
  return false
}

function arrangeableUnitCount(sel: SelectionSet, sections: Section[]): number {
  const memberOfSelected = new Set<string>()
  for (const sid of sel.sectionIds) {
    const s = sections.find((x) => x.id === sid)
    for (const cid of (s?.cardIds ?? [])) memberOfSelected.add(cid)
  }
  let cards = 0
  for (const cid of sel.cardIds) if (!memberOfSelected.has(cid)) cards++
  return sel.textIds.size + sel.labelIds.size + sel.sectionIds.size + cards
}
```

- [ ] **Step 2: `handleMouseDown` 命中判定改用 `pointInSelection`（去重）**

把 `handleMouseDown` 中这一段（约第 418–453 行）：

```ts
        let hitSelected = false

        for (const cid of selection.cardIds) {
          const c = cards.find((cd) => cd.id === cid)
          if (c && coords.x >= c.x && coords.x <= c.x + c.width &&
              coords.y >= c.y && coords.y <= c.y + (c.height ?? 200)) {
            hitSelected = true; break
          }
        }
        if (!hitSelected) {
          for (const lid of selection.labelIds) {
            const l = labels.find((lb) => lb.id === lid)
            if (l && coords.x >= l.x && coords.x <= l.x + l.width &&
                coords.y >= l.y && coords.y <= l.y + 40) {
              hitSelected = true; break
            }
          }
        }
        if (!hitSelected) {
          for (const sid of selection.sectionIds) {
            const sec = sections.find((s) => s.id === sid)
            if (sec && coords.x >= sec.x && coords.x <= sec.x + sec.width &&
                coords.y >= sec.y && coords.y <= sec.y + sec.height) {
              hitSelected = true; break
            }
          }
        }
        if (!hitSelected) {
          for (const tid of selection.textIds) {
            const t = texts.find((tx) => tx.id === tid)
            if (t && coords.x >= t.x && coords.x <= t.x + t.width &&
                coords.y >= t.y && coords.y <= t.y + (t.height ?? 24)) {
              hitSelected = true; break
            }
          }
        }
```

替换为：

```ts
        const hitSelected = pointInSelection(coords, selection, cards, labels, sections, texts)
```

（`coords` 上一行 `const coords = toCanvasCoords(e.clientX, e.clientY)` 保留不动；下方 `if (hitSelected) { ... }` 保留不动。`handleMouseDown` 的 `useCallback` 依赖数组本就含 `cards, labels, sections, texts, selection, toCanvasCoords`，无需改。）

- [ ] **Step 3: 新增 `arrangeUnits` hook**

在 `const addText = useStore((s) => s.addText)`（约第 136 行，Task 3 加的那行）之后增加：

```ts
  const arrangeUnits = useStore((s) => s.arrangeUnits)
```

- [ ] **Step 4: `handleContextMenu` 加「选区分支」**

在 `handleContextMenu` 中、`connectingFrom` 守卫块之后、`const noteCard = ...` 之前（约第 690–692 行）插入：

```ts
    const selCoords = toCanvasCoords(e.clientX, e.clientY)
    if (arrangeableUnitCount(selection, sections) >= 2 &&
        pointInSelection(selCoords, selection, cards, labels, sections, texts)) {
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: '自动排布',
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
            onClick: () => arrangeUnits({
              cardIds: [...selection.cardIds],
              labelIds: [...selection.labelIds],
              sectionIds: [...selection.sectionIds],
              textIds: [...selection.textIds],
            }),
          },
        ],
      })
      return
    }
```

- [ ] **Step 5: 补 `handleContextMenu` 的 useCallback 依赖**

把 `handleContextMenu` 的依赖数组（约第 771 行）：

```ts
  }, [cards, sections, addCard, addLabel, addText, addSection, deleteCard, setEditingCard, updateCard, toCanvasCoords, connectingFrom, compactSection])
```

改为（追加 `arrangeUnits, selection, labels, texts`）：

```ts
  }, [cards, sections, labels, texts, selection, addCard, addLabel, addText, addSection, deleteCard, setEditingCard, updateCard, toCanvasCoords, connectingFrom, compactSection, arrangeUnits])
```

- [ ] **Step 6: 类型检查 + 构建**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

Run: `npm run build`
Expected: 末尾出现 `✓ built`（renderer + main + preload 三段均构建成功），无 error。

- [ ] **Step 7: 手动验证（Electron GUI，由人执行；subagent 跳过此步）**

Run: `npm run dev`，在打开的应用中：
1. 框选多个散落文本框 → 右键选区 → 出现「自动排布」→ 点击 → 它们被拉成对齐的紧凑列，整体仍锚在原区域左上角、无重叠。
2. 框选含 1 个分区 + 几个文本框/卡片 → 自动排布 → 分区作为整块参与，内部卡片随分区同向移动、相对位置不变。
3. 只选 1 个单位 / 只选 1 个分区 → 右键**不**出现「自动排布」。
4. 右键落在空白处 / 非选中元素 → 出现原有菜单，行为不变。
5. 群组拖动仍正常（Step 2 重构未破坏 `handleMouseDown`）。
6. 重启 app 后排布结果持久化保留。

Expected: 以上全部符合预期。

- [ ] **Step 8: Commit**

```bash
git add src/components/CanvasView.tsx
git commit -m "$(cat <<'EOF'
feat: 多选右键「自动排布」+ 抽取 pointInSelection 去重

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage（对 spec §目标）：**
1. ≥2 单位选中且右键落在选中元素上出现「自动排布」→ Task 2 Step 4 + `arrangeableUnitCount`/`pointInSelection`。✅
2. 紧凑分列算法 → Task 1 Step 2（列聚类 + 堆叠，GAP=20）。✅
3. 就地锚定 (minX,minY) → Task 1 `originX/originY`。✅
4. 分区当整块 + 成员卡片随移 + 成员不单独参与 → Task 1（`memberOfSelected` 排除、`sectionDelta`、`cardToSection`）。✅
5. 文本/卡片/标题/分区混选 → Task 1 单位收集四类。✅
6. 排布后选区不变 → 未触碰 `setSelection`。✅
7. persist + 同步 → Task 1 末尾 `get().persist()`。✅
8. 去重 `pointInSelection` 共用 → Task 2 Step 1/2。✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码与确切命令。✅

**Type consistency：** `arrangeUnits` 入参形状（`{cardIds/labelIds/sectionIds/textIds: string[]}`）在 store 声明、实现、CanvasView 调用三处一致；`pointInSelection`/`arrangeableUnitCount` 签名在定义与调用处一致；`SelectionSet`、`Card/CanvasLabel/Section/TextBox` 均为现有类型。✅
