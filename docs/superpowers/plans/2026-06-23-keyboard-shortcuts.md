# 画布快捷键（轻量层 + 删除二次确认）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 FloatAnchor 画布加一套轻量快捷键（新建 C/T/R、全选、删除、自动排布、微移、缩放、进入编辑），删除走自定义二次确认弹窗。

**Architecture:** store 加两个原子 action（`deleteUnits`/`nudgeUnits`，镜像现有 `arrangeUnits`）；新建可复用 `ConfirmModal` 组件；CanvasView 就地扩展现有全局 keydown effect 做快捷键分发，并新增视口居中/缩放 helper 与 `confirmDelete` 状态 + 渲染 ConfirmModal。

**Tech Stack:** React 18 + TypeScript + Zustand + Electron。

## Global Constraints

- `Mod` = `e.metaKey || e.ctrlKey`（Mac ⌘ / Win Ctrl）。字母键比较用 `e.key.toLowerCase()`，按 `e.shiftKey` 区分（Shift 会让字母 e.key 变大写）。
- **编辑态/弹窗禁用**：keydown 分发开头判断——`document.activeElement` 为 INPUT/TEXTAREA 或 `isContentEditable`，或 store `editingCardId`/`editingTextId` 非空，或 `confirmDelete` 非空 → 直接 return。
- 键位：C=新建卡片、T=新建文本、R=新建分区（均视口中心；卡片/文本自动进编辑）；`Mod+A`=全选；`Mod+Shift+A`=自动排布；`Enter`=单选 1 个卡片/文本时进入编辑；`Delete`/`Backspace`=弹确认后删除选中（连线模式下 Backspace 仍取消连线）；方向键=微移 1px，`Shift+方向键`=10px；`Mod+=`/`Mod++`=放大、`Mod+-`=缩小、`Mod+0`=复位（均以视口中心为锚）。
- `preventDefault`：`Mod+A`、`Mod+=/-/0`、方向键、Delete/Backspace（删除分支）。
- 删除语义：删除**所有高亮选中**元素（含框选到的分区成员卡片）；删除分区时把被删卡片从其它分区成员列表剔除；删除单个分区容器不连带删其成员（成员仅在自身被选中时才删）。右键/垃圾桶删除不变、不加确认。
- ConfirmModal：复用现有 `.modal-overlay`/`.modal-box`/`.modal-body`；Enter=确认、Esc=取消、点遮罩=取消、挂载聚焦确认按钮；确认按钮 danger 红色。
- 缩放 clamp 到 `MIN_SCALE`(0.15)/`MAX_SCALE`(3)。
- 不引入撤销/重做、复制粘贴、`?` 面板、新依赖。
- 项目无测试框架，门禁 `npx tsc -p tsconfig.json`（noEmit；node_modules 已装）；Task 2/3 另跑 `npm run build`。
- Electron GUI，手动验证留收尾由人执行——subagent 跳过 GUI 手测，不因此报 BLOCKED。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: store `deleteUnits` + `nudgeUnits`

**Files:**
- Modify: `src/store.ts`（`AppState` 接口在 `arrangeUnits` 声明后加两行；实现插在 `arrangeUnits` 实现之后、`addConnection` 实现之前，约第 1035 行 `addConnection:` 前）

**Interfaces:**
- Consumes：现有类型与 `get/set/persist`。
- Produces：
  - `deleteUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }) => void`
  - `nudgeUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }, dx: number, dy: number) => void`

- [ ] **Step 1: `AppState` 接口加声明**

在 `arrangeUnits: (ids: {...}) => void`（约第 59 行）下一行加：

```ts
  deleteUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }) => void
  nudgeUnits: (ids: { cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] }, dx: number, dy: number) => void
```

- [ ] **Step 2: 实现两个 action**

在 `arrangeUnits` 实现的闭合 `},` 之后、`addConnection: (fromCardId, toCardId) => {`（约第 1035 行）之前插入：

```ts
  deleteUnits: (ids) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    const cardIds = new Set(ids.cardIds)
    const labelIds = new Set(ids.labelIds)
    const sectionIds = new Set(ids.sectionIds)
    const textIds = new Set(ids.textIds)
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== activeCanvasId) return c
        return {
          ...c,
          cards: c.cards.filter((cd) => !cardIds.has(cd.id)),
          labels: (c.labels ?? []).filter((l) => !labelIds.has(l.id)),
          texts: (c.texts ?? []).filter((t) => !textIds.has(t.id)),
          sections: (c.sections ?? [])
            .filter((sec) => !sectionIds.has(sec.id))
            .map((sec) => {
              const members = sec.cardIds ?? []
              const kept = members.filter((id) => !cardIds.has(id))
              return kept.length !== members.length ? { ...sec, cardIds: kept } : sec
            }),
        }
      }),
      editingCardId: s.editingCardId && cardIds.has(s.editingCardId) ? null : s.editingCardId,
      editingTextId: s.editingTextId && textIds.has(s.editingTextId) ? null : s.editingTextId,
    }))
    get().persist()
  },

  nudgeUnits: (ids, dx, dy) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    if (dx === 0 && dy === 0) return
    const cardIds = new Set(ids.cardIds)
    const labelIds = new Set(ids.labelIds)
    const sectionIds = new Set(ids.sectionIds)
    const textIds = new Set(ids.textIds)
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== activeCanvasId) return c
        return {
          ...c,
          cards: c.cards.map((cd) => cardIds.has(cd.id) ? { ...cd, x: cd.x + dx, y: cd.y + dy } : cd),
          labels: (c.labels ?? []).map((l) => labelIds.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l),
          texts: (c.texts ?? []).map((t) => textIds.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t),
          sections: (c.sections ?? []).map((sec) => sectionIds.has(sec.id) ? { ...sec, x: sec.x + dx, y: sec.y + dy } : sec),
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
feat: store 新增 deleteUnits / nudgeUnits 原子操作

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ConfirmModal` 组件 + 样式

**Files:**
- Create: `src/components/ConfirmModal.tsx`
- Modify: `src/index.css`（文件末尾追加确认弹窗按钮样式）

**Interfaces:**
- Produces：默认导出组件 `ConfirmModal`，Props `{ message: string; confirmText?: string; cancelText?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }`。

- [ ] **Step 1: 创建 `src/components/ConfirmModal.tsx`**

```tsx
import { useEffect, useRef } from 'react'

interface Props {
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  message,
  confirmText = '删除',
  cancelText = '取消',
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
          <div className="confirm-actions">
            <button className="confirm-btn" onClick={onCancel}>{cancelText}</button>
            <button
              ref={confirmRef}
              className={`confirm-btn${danger ? ' danger' : ''}`}
              onClick={onConfirm}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 `src/index.css` 末尾追加样式**

```css
/* ===== Confirm Modal ===== */
.confirm-message {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 18px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-btn {
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.12s;
}

.confirm-btn:hover {
  background: var(--accent-light);
}

.confirm-btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.confirm-btn.danger:hover {
  opacity: 0.9;
}
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。组件此时未被引用，tsc 仍应通过。

Run: `npm run build`
Expected: 末尾三段 `✓ built`，无 error。

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfirmModal.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat: 新增可复用 ConfirmModal 确认弹窗

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CanvasView 快捷键接入

**Files:**
- Modify: `src/components/CanvasView.tsx`（import ConfirmModal；hooks 加 deleteUnits/nudgeUnits；新增 confirmDelete state；新增视口 helper；重写全局 keydown effect；渲染 ConfirmModal）

**Interfaces:**
- Consumes：Task 1 的 `deleteUnits/nudgeUnits` + 既有 `arrangeUnits/addCard/addText/addSection/setEditingCard/setEditingText`；Task 2 的 `ConfirmModal`；既有 `toCanvasCoords/applyTransform/scheduleCull/viewportRef/pan/scaleVal/MIN_SCALE/MAX_SCALE/selection/setSelection/emptySelection/selectionEmpty/connectingFrom/connections/deleteConnection`。

- [ ] **Step 1: import ConfirmModal**

第 8 行 `import MoveToModal from './MoveToModal'` 之后加：

```tsx
import ConfirmModal from './ConfirmModal'
```

- [ ] **Step 2: hooks 加 deleteUnits / nudgeUnits**

第 189 行 `const arrangeUnits = useStore((s) => s.arrangeUnits)` 之后加：

```tsx
  const deleteUnits = useStore((s) => s.deleteUnits)
  const nudgeUnits = useStore((s) => s.nudgeUnits)
```

- [ ] **Step 3: 新增 confirmDelete state**

第 222 行 `const [moveModalCardId, setMoveModalCardId] = useState<string | null>(null)` 之后加：

```tsx
  const [confirmDelete, setConfirmDelete] = useState<{ cardIds: string[]; labelIds: string[]; sectionIds: string[]; textIds: string[] } | null>(null)
```

- [ ] **Step 4: 新增视口 helper**

在 `toCanvasCoords` 的 `useCallback` 定义（其闭合 `}, [])` 行）之后插入三个 helper：

```tsx
  const viewportCenterCanvasCoords = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return toCanvasCoords(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }, [toCanvasCoords])

  const zoomAroundCenter = useCallback((factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.width / 2
    const cy = rect.height / 2
    const s = scaleVal.current
    const ns = Math.min(Math.max(s * factor, MIN_SCALE), MAX_SCALE)
    const ratio = ns / s
    pan.current = { x: Math.round(cx - (cx - pan.current.x) * ratio), y: Math.round(cy - (cy - pan.current.y) * ratio) }
    scaleVal.current = ns
    applyTransform()
    scheduleCull()
  }, [applyTransform, scheduleCull])

  const resetZoomAroundCenter = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.width / 2
    const cy = rect.height / 2
    const s = scaleVal.current
    const ratio = 1 / s
    pan.current = { x: Math.round(cx - (cx - pan.current.x) * ratio), y: Math.round(cy - (cy - pan.current.y) * ratio) }
    scaleVal.current = 1
    applyTransform()
    scheduleCull()
  }, [applyTransform, scheduleCull])
```

- [ ] **Step 5: 重写全局 keydown effect**

把现有 effect（第 660–674 行）：

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (connectingFrom) setConnectingFrom(null)
        if (!selectionEmpty(selection)) setSelection(emptySelection())
      }
      if (e.key === 'Backspace' && connectingFrom) {
        const last = connections[connections.length - 1]
        if (last) deleteConnection(last.id)
        setConnectingFrom(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [connectingFrom, connections, deleteConnection, selection])
```

整段替换为：

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 编辑输入上下文 / 确认弹窗打开 → 不处理全局快捷键
      const ae = document.activeElement as HTMLElement | null
      const typing = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      const st = useStore.getState()
      if (typing || st.editingCardId || st.editingTextId || confirmDelete) return

      // 连线 / Esc（保留并优先）
      if (e.key === 'Escape') {
        if (connectingFrom) setConnectingFrom(null)
        if (!selectionEmpty(selection)) setSelection(emptySelection())
        return
      }
      if (e.key === 'Backspace' && connectingFrom) {
        const last = connections[connections.length - 1]
        if (last) deleteConnection(last.id)
        setConnectingFrom(null)
        return
      }

      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const canvas = st.canvases.find((c) => c.id === st.activeCanvasId)
      if (!canvas) return

      const selIds = () => ({
        cardIds: [...selection.cardIds],
        labelIds: [...selection.labelIds],
        sectionIds: [...selection.sectionIds],
        textIds: [...selection.textIds],
      })

      if (mod && e.shiftKey && k === 'a') {
        e.preventDefault()
        arrangeUnits(selIds())
        return
      }
      if (mod && !e.shiftKey && k === 'a') {
        e.preventDefault()
        setSelection({
          cardIds: new Set((canvas.cards ?? []).map((c) => c.id)),
          labelIds: new Set((canvas.labels ?? []).map((l) => l.id)),
          sectionIds: new Set((canvas.sections ?? []).map((s) => s.id)),
          textIds: new Set((canvas.texts ?? []).map((t) => t.id)),
        })
        return
      }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAroundCenter(1.1); return }
      if (mod && k === '-') { e.preventDefault(); zoomAroundCenter(1 / 1.1); return }
      if (mod && k === '0') { e.preventDefault(); resetZoomAroundCenter(); return }
      if (mod) return

      if (k === 'c') { const p = viewportCenterCanvasCoords(); addCard(p.x - 186, p.y - 40); return }
      if (k === 't') { const p = viewportCenterCanvasCoords(); addText(p.x - 150, p.y - 20); return }
      if (k === 'r') { const p = viewportCenterCanvasCoords(); addSection(p.x - 300, p.y - 200); return }

      if (e.key === 'Enter') {
        const total = selection.cardIds.size + selection.labelIds.size + selection.sectionIds.size + selection.textIds.size
        if (total === 1) {
          const cid = [...selection.cardIds][0]
          const tid = [...selection.textIds][0]
          if (cid) setEditingCard(cid)
          else if (tid) setEditingText(tid)
        }
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !selectionEmpty(selection)) {
        e.preventDefault()
        setConfirmDelete(selIds())
        return
      }

      if (!selectionEmpty(selection) &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        nudgeUnits(selIds(), dx, dy)
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [connectingFrom, connections, deleteConnection, selection, confirmDelete, arrangeUnits, addCard, addText, addSection, setEditingCard, setEditingText, nudgeUnits, zoomAroundCenter, resetZoomAroundCenter, viewportCenterCanvasCoords])
```

- [ ] **Step 6: 渲染 ConfirmModal**

在 MoveToModal 渲染块（第 1145–1150 行）之后、`</main>`（第 1151 行）之前插入：

```tsx
      {confirmDelete && (
        <ConfirmModal
          message={`确定删除选中的 ${confirmDelete.cardIds.length + confirmDelete.labelIds.length + confirmDelete.sectionIds.length + confirmDelete.textIds.length} 个元素吗？删除后无法恢复。`}
          confirmText="删除"
          danger
          onConfirm={() => {
            deleteUnits(confirmDelete)
            setSelection(emptySelection())
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
```

- [ ] **Step 7: 类型检查 + 构建**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

Run: `npm run build`
Expected: 末尾三段 `✓ built`，无 error。

- [ ] **Step 8: 手动验证（Electron GUI，由人执行；subagent 跳过此步）**

Run: `npm run dev`：
1. 非编辑态按 `C`/`T`/`R` → 视口中心建卡片/文本/分区（卡片、文本自动进编辑）。
2. 编辑某卡片/文本时按 `C/T/R/Delete/方向键` → 只是正常打字/移光标，**不触发**全局操作。
3. `Mod+A` 全选；`Mod+Shift+A` 整理；`Esc` 清选。
4. 框选若干 → `Delete`/`Backspace` 弹确认窗（显示"N 个元素"）；`Enter`/点删除才删、`Esc`/取消不删；弹窗开时其它快捷键无效。
5. `方向键`/`Shift+方向键` 微移 1/10px；单选 1 个卡片 `Enter` 进入编辑。
6. `Mod+=`/`Mod+-`/`Mod+0` 以视口中心缩放/复位，右下角百分比同步。
7. 现有框选、群组拖动、连线、Esc 无回归。

- [ ] **Step 9: Commit**

```bash
git add src/components/CanvasView.tsx
git commit -m "$(cat <<'EOF'
feat: 画布快捷键（新建/全选/删除确认/排布/微移/缩放）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage（对 spec §2 键位表 + §3/§4/§6）：**
- C/T/R 视口中心创建 → Task 3 Step 5（含 `viewportCenterCanvasCoords` Step 4）。✅
- Mod+A 全选 / Mod+Shift+A 排布 → Task 3 Step 5。✅
- Enter 单选进入编辑 → Step 5。✅
- Delete/Backspace 二次确认 → Step 5（setConfirmDelete）+ Step 6（ConfirmModal）+ Task 1 deleteUnits + Task 2 组件。✅
- 方向键微移 1/10px → Step 5 + Task 1 nudgeUnits。✅
- Mod+=/-/0 视口中心缩放 → Step 4 helper + Step 5。✅
- 编辑态/弹窗禁用 → Step 5 开头守卫。✅
- Mod 自适应 + 字母 toLowerCase + shiftKey → Step 5。✅
- 删除语义（删高亮、删分区剔成员、不连带删分区成员）→ Task 1 deleteUnits。✅
- ConfirmModal 复用 modal 类 + Enter/Esc/遮罩/聚焦 → Task 2。✅
- 缩放 clamp MIN/MAX_SCALE → Step 4。✅

**Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码与确切命令。✅

**Type consistency：** `deleteUnits`/`nudgeUnits` 入参形状在 store 声明/实现/CanvasView 调用一致；`confirmDelete` state 形状与 `selIds()` 返回、`deleteUnits` 入参、ConfirmModal 计数一致；`ConfirmModal` Props 在定义与使用处一致；helper 名 `viewportCenterCanvasCoords`/`zoomAroundCenter`/`resetZoomAroundCenter` 在定义与 effect 调用处一致；复用既有 `MIN_SCALE`/`MAX_SCALE`/`applyTransform`/`scheduleCull`/`toCanvasCoords`/`viewportRef`/`pan`/`scaleVal` 均为现有符号。✅
