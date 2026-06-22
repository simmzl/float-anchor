# 画布文本框（Add Text Box）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在画布上新增「文本框」元素——一段多行普通正文，透明无边框，宽度可拖、高度自适应，可拖动/编辑/删除，并参与框选与群组拖动。

**Architecture:** 方案 A —— 新建一等公民实体 `TextBox`，镜像现有 `CanvasLabel`（标题）/`Section`（分区）的模式：独立类型 + `Canvas.texts[]` 数组 + 独立组件 `TextBoxComponent` + Zustand actions，并在 `CanvasView` 的选择/框选/群组拖动/右键菜单/渲染等集成点各加一份镜像接线。同步引擎按 canvas 整体序列化 JSON，`texts` 自动随本地持久化与坚果云 WebDAV 同步，无需改动同步逻辑。

**Tech Stack:** Electron + React 18 + TypeScript + Vite + Zustand。

## Global Constraints

- 全部交互的坐标位移必须除以画布 `scale` 换算（与 card/label 现有处理一致）。
- 文本框视觉：**透明、无边框、无背景**，仅显示文字（14px / 正常字重 / `pre-wrap` 保留换行）。**不要**照抄 `.canvas-label` 的 border/background。
- 编辑器用 `<textarea>`：**Enter = 换行**（不提交），`Esc` / blur = 退出并提交。
- 空文本框**保留**（不自动删除），可经 hover 删除按钮移除。
- 宽度调整只动 `width`（右边缘竖直手柄）；高度恒为内容自适应，由组件用 `ResizeObserver` 测量后回写 `height`，仅供框选/命中判定几何使用。
- 不做：富文本、标题级别、进分区成员、连线、顶部工具栏按钮、字号/颜色自定义。
- 项目无测试框架。每个 Task 的门禁为类型检查：`npx tsc -p tsconfig.json`（`tsconfig.json` 已配 `noEmit: true`，纯检查不产物），外加列出的手动验证。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: 数据模型 + Store

**Files:**
- Modify: `src/types.ts`（新增 `TextBox` 接口；`Canvas` 增加 `texts?`）
- Modify: `src/store.ts`（`AppState` 接口与实现新增 `editingTextId` 状态、`addText/updateText/deleteText/moveText/setEditingText`、`useActiveTexts` selector）

**Interfaces:**
- Produces:
  - 类型 `TextBox { id: string; text: string; x: number; y: number; width: number; height?: number; sourceId?: string }`
  - `Canvas.texts?: TextBox[]`
  - store actions：`addText(x: number, y: number): void`、`updateText(textId: string, patch: Partial<TextBox>): void`、`deleteText(textId: string): void`、`moveText(textId: string, x: number, y: number): void`、`setEditingText(textId: string | null): void`
  - store state：`editingTextId: string | null`
  - selector：`useActiveTexts(): TextBox[]`

- [ ] **Step 1: 在 `src/types.ts` 增加 `TextBox` 接口**

在 `Section` 接口之后（约第 32 行后）插入：

```ts
export interface TextBox {
  id: string
  text: string
  x: number
  y: number
  width: number
  height?: number
  sourceId?: string
}
```

- [ ] **Step 2: 在 `Canvas` 接口增加 `texts` 字段**

把 `Canvas` 接口（约第 46 行）改为：

```ts
export interface Canvas {
  id: string
  name: string
  cards: Card[]
  labels?: CanvasLabel[]
  sections?: Section[]
  connections?: Connection[]
  texts?: TextBox[]
  viewport?: CanvasViewport
}
```

- [ ] **Step 3: 在 `src/store.ts` 导入 `TextBox` 类型**

把第 4 行的类型导入改为（追加 `TextBox`）：

```ts
import type { Canvas, Card, CanvasLabel, Section, Connection, CanvasViewport, AppSettings, WebDAVConfig, WebDAVSyncDecision, TextBox } from './types'
```

- [ ] **Step 4: 在 `AppState` 接口声明新状态与 actions**

在 `editingCardId: string | null`（约第 9 行）下一行增加：

```ts
  editingTextId: string | null
```

在 `setHighlightCard: (cardId: string | null) => void`（约第 40 行）之后增加：

```ts
  addText: (x: number, y: number) => void
  updateText: (textId: string, patch: Partial<TextBox>) => void
  deleteText: (textId: string) => void
  moveText: (textId: string, x: number, y: number) => void
  setEditingText: (textId: string | null) => void
```

- [ ] **Step 5: 初始化 `editingTextId`**

在 store 实现的 `editingCardId: null,`（约第 70 行）下一行增加：

```ts
  editingTextId: null,
```

- [ ] **Step 6: 实现 text actions**

在 `setHighlightCard: (cardId) => set({ highlightCardId: cardId }),`（约第 533 行）之后插入：

```ts
  addText: (x, y) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    const text: TextBox = { id: uuid(), text: '', x, y, width: 300 }
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === activeCanvasId
          ? { ...c, texts: [...(c.texts ?? []), text] }
          : c,
      ),
      editingTextId: text.id,
    }))
    get().persist()
  },

  updateText: (textId, patch) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === activeCanvasId
          ? { ...c, texts: (c.texts ?? []).map((t) => t.id === textId ? { ...t, ...patch } : t) }
          : c,
      ),
    }))
    get().persist()
  },

  deleteText: (textId) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === activeCanvasId
          ? { ...c, texts: (c.texts ?? []).filter((t) => t.id !== textId) }
          : c,
      ),
      editingTextId: s.editingTextId === textId ? null : s.editingTextId,
    }))
    get().persist()
  },

  moveText: (textId, x, y) => {
    const { activeCanvasId } = get()
    if (!activeCanvasId) return
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === activeCanvasId
          ? { ...c, texts: (c.texts ?? []).map((t) => t.id === textId ? { ...t, x, y } : t) }
          : c,
      ),
    }))
    get().persist()
  },

  setEditingText: (textId) => set({ editingTextId: textId }),
```

- [ ] **Step 7: 增加 `useActiveTexts` selector**

在 `useActiveLabels`（约第 947 行）之后插入：

```ts
export function useActiveTexts() {
  return useStore(
    (s) => {
      const c = s.canvases.find((c) => c.id === s.activeCanvasId)
      return c?.texts ?? []
    },
    (a, b) => a === b,
  )
}
```

- [ ] **Step 8: 类型检查**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0），即类型检查通过。

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/store.ts
git commit -m "$(cat <<'EOF'
feat: 文本框数据模型与 store actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: TextBox 组件 + 样式

**Files:**
- Create: `src/components/TextBox.tsx`
- Modify: `src/index.css`（在 `.label-action-btn.danger:hover {...}` 块之后，约第 1390 行后，新增文本框样式）

**Interfaces:**
- Consumes（来自 Task 1）：`useStore` 的 `updateText / deleteText / moveText / setEditingText / editingTextId`；类型 `TextBox`。
- Produces：默认导出 React 组件 `TextBoxComponent`，Props `{ text: TextBox; scale: number; selected?: boolean }`。

- [ ] **Step 1: 创建 `src/components/TextBox.tsx`**

```tsx
import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useStore } from '../store'
import type { TextBox as TextBoxType } from '../types'

interface Props {
  text: TextBoxType
  scale: number
  selected?: boolean
}

const TextBoxComponent = React.memo(function TextBoxComponent({ text, scale, selected }: Props) {
  const updateText = useStore((s) => s.updateText)
  const deleteText = useStore((s) => s.deleteText)
  const moveText = useStore((s) => s.moveText)
  const setEditingText = useStore((s) => s.setEditingText)
  const isEditing = useStore((s) => s.editingTextId === text.id)

  const [editText, setEditText] = useState(text.text)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const clickCount = useRef(0)
  const clickTimer = useRef<ReturnType<typeof setTimeout>>()

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  // 进入编辑态：同步内容、聚焦、光标置末、撑开高度
  useEffect(() => {
    if (isEditing) {
      setEditText(text.text)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
        autoGrow(el)
      })
    }
  }, [isEditing, text.text])

  // 非编辑态测量渲染高度并回写，供框选/命中判定使用精确几何
  useEffect(() => {
    if (isEditing) return
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const h = Math.round(el.getBoundingClientRect().height / scale)
      if (h > 0 && Math.abs(h - (text.height ?? 0)) > 1) {
        updateText(text.id, { height: h })
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isEditing, scale, text.id, text.height, text.text, text.width, updateText])

  const commitEdit = useCallback(() => {
    setEditingText(null)
    if (editText !== text.text) {
      updateText(text.id, { text: editText })
    }
  }, [editText, text.id, text.text, setEditingText, updateText])

  const handleClick = useCallback(() => {
    clickCount.current++
    if (clickCount.current === 1) {
      clickTimer.current = setTimeout(() => { clickCount.current = 0 }, 350)
    } else if (clickCount.current === 2) {
      clearTimeout(clickTimer.current)
      clickCount.current = 0
      setEditingText(text.id)
    }
  }, [setEditingText, text.id])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isEditing || e.button !== 0) return
    if (selected) return
    e.stopPropagation()
    e.preventDefault()
    setIsDragging(true)
    const sx = e.clientX
    const sy = e.clientY
    const ox = text.x
    const oy = text.y
    const s = scale
    let raf = 0
    const onMove = (ev: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() =>
        moveText(text.id, ox + (ev.clientX - sx) / s, oy + (ev.clientY - sy) / s),
      )
    }
    const onUp = () => {
      cancelAnimationFrame(raf)
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [isEditing, text.id, text.x, text.y, scale, moveText, selected])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const sx = e.clientX
    const ow = text.width
    const s = scale
    let raf = 0
    const onMove = (ev: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const next = Math.max(80, ow + (ev.clientX - sx) / s)
        updateText(text.id, { width: next })
      })
    }
    const onUp = () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [text.id, text.width, scale, updateText])

  return (
    <div
      ref={containerRef}
      className={`canvas-text ${isDragging ? 'dragging' : ''} ${selected ? 'multi-selected' : ''}`}
      style={{ left: text.x, top: text.y, width: text.width }}
      onMouseDown={handleDragStart}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="text-edit-input"
          value={editText}
          onChange={(e) => { setEditText(e.target.value); autoGrow(e.target) }}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); commitEdit() }
            e.stopPropagation()
          }}
          spellCheck={false}
        />
      ) : (
        <div className={`text-content ${text.text ? '' : 'placeholder'}`}>
          {text.text || '输入文本'}
        </div>
      )}

      {!isEditing && (
        <div className="text-resize-handle" onMouseDown={handleResizeStart} />
      )}

      {isHovered && !isEditing && (
        <div className="text-actions">
          <button className="text-action-btn" title="编辑" onClick={(e) => { e.stopPropagation(); setEditingText(text.id) }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button className="text-action-btn danger" title="删除" onClick={(e) => { e.stopPropagation(); deleteText(text.id) }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
})

export default TextBoxComponent
```

- [ ] **Step 2: 在 `src/index.css` 增加文本框样式**

在 `.label-action-btn.danger:hover { ... }` 块之后（约第 1390 行后）插入：

```css
/* ===== Canvas Text Box ===== */
.canvas-text {
  position: absolute;
  cursor: grab;
  user-select: none;
  padding: 4px 6px;
  z-index: 5;
}

.canvas-text.dragging {
  opacity: 0.8;
  cursor: grabbing;
  z-index: 100;
}

.canvas-text.multi-selected {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.text-content {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 1em;
}

.text-content.placeholder {
  color: var(--text-muted);
}

.text-edit-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  resize: none;
  overflow: hidden;
  padding: 0;
  margin: 0;
  display: block;
}

.text-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
  opacity: 0;
}

.canvas-text:hover .text-resize-handle {
  opacity: 1;
}

.text-actions {
  position: absolute;
  top: -4px;
  right: -8px;
  display: flex;
  gap: 2px;
}

.text-action-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--card-bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.12s;
}

.text-action-btn:hover {
  color: var(--accent);
  background: var(--accent-light);
}

.text-action-btn.danger:hover {
  color: var(--danger);
  background: rgba(229, 92, 92, 0.1);
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。组件此时尚未被引用，但 tsc 会检查 `src` 下全部文件，应通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/TextBox.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat: 文本框组件与样式

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 画布集成 —— 创建 / 渲染 / 编辑单个文本框

**Files:**
- Modify: `src/components/CanvasView.tsx`（import 组件与 selector、`SelectionSet` 加 `textIds`、hooks、右键菜单项、渲染块）

**Interfaces:**
- Consumes（来自 Task 1/2）：`useActiveTexts`、`addText`、默认导出组件 `TextBoxComponent`。
- Produces：`SelectionSet.textIds: Set<string>`（供 Task 4 填充）。

- [ ] **Step 1: 导入组件与 selector**

第 4 行（`import CanvasLabelComponent from './CanvasLabel'`）之后增加：

```tsx
import TextBoxComponent from './TextBox'
```

第 2 行的 store 导入末尾追加 `useActiveTexts`，改为：

```tsx
import { useStore, useActiveCanvasMeta, useActiveCards, useActiveConnections, useActiveLabels, useActiveSections, useHighlightCard, useSettings, useActiveTexts } from '../store'
```

- [ ] **Step 2: `SelectionSet` 增加 `textIds`**

把 `SelectionSet` 接口（约第 16 行）改为：

```tsx
interface SelectionSet {
  cardIds: Set<string>
  labelIds: Set<string>
  sectionIds: Set<string>
  textIds: Set<string>
}
```

把 `emptySelection`（约第 22 行）改为：

```tsx
function emptySelection(): SelectionSet {
  return { cardIds: new Set(), labelIds: new Set(), sectionIds: new Set(), textIds: new Set() }
}
```

把 `selectionEmpty`（约第 26 行）改为：

```tsx
function selectionEmpty(sel: SelectionSet): boolean {
  return sel.cardIds.size === 0 && sel.labelIds.size === 0 && sel.sectionIds.size === 0 && sel.textIds.size === 0
}
```

- [ ] **Step 3: 增加 `addText` 与 `texts` hooks**

在 `const addLabel = useStore((s) => s.addLabel)`（约第 135 行）之后增加：

```tsx
  const addText = useStore((s) => s.addText)
```

在 `const labels = useActiveLabels()`（约第 144 行）之后增加：

```tsx
  const texts = useActiveTexts()
```

- [ ] **Step 4: 右键空白菜单增加「创建文本」**

在「创建标题」菜单项对象（约第 757–761 行，以 `onClick: () => addLabel(coords.x, coords.y),` 结尾的 `}`）之后插入：

```tsx
            {
              label: '创建文本',
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="14" y2="17" /></svg>,
              onClick: () => addText(coords.x, coords.y),
            },
```

把 `handleContextMenu` 的 `useCallback` 依赖数组（约第 771 行）中加入 `addText`：

```tsx
  }, [cards, sections, addCard, addLabel, addText, addSection, deleteCard, setEditingCard, updateCard, toCanvasCoords, connectingFrom, compactSection])
```

- [ ] **Step 5: 渲染文本框**

在 labels 渲染块（约第 952–954 行）之后插入：

```tsx
          {texts.map((t) => (
            <TextBoxComponent key={t.id} text={t} scale={scaleVal.current} selected={selection.textIds.has(t.id)} />
          ))}
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

- [ ] **Step 7: 手动验证**

Run: `npm run dev`，在打开的应用中：
1. 画布空白处右键 → 出现「创建文本」菜单项；点击 → 在点击位置出现空文本框并自动进入编辑态（光标可见）。
2. 输入多行文本（按 Enter 换行），文字随输入增多、文本框高度自适应增长。
3. 按 `Esc`（或点击文本框外部）退出编辑 → 文字以多行 `pre-wrap` 显示，**无边框、无背景**。
4. 鼠标按住文字拖动 → 文本框移动；拖右边缘手柄（`ew-resize` 光标）→ 宽度改变、文字重排、高度自适应。
5. 双击文本框 → 重新进入编辑；hover 出现编辑/删除按钮，点删除 → 文本框消失。
6. 切换到别的画布再切回 / 重启 `npm run dev` → 文本框及其内容仍在（持久化生效）。

Expected: 以上全部符合预期。

- [ ] **Step 8: Commit**

```bash
git add src/components/CanvasView.tsx
git commit -m "$(cat <<'EOF'
feat: 画布支持创建/渲染/编辑文本框

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 框选（lasso）+ 群组拖动

**Files:**
- Modify: `src/components/CanvasView.tsx`（type 导入、`computeSelection`、lasso 调用点、按下命中判定、群组拖动 effect、`.closest` 判定、`handleMouseDown` 依赖）

**Interfaces:**
- Consumes（来自 Task 1/3）：类型 `TextBox`、`texts` 局部变量、`SelectionSet.textIds`、store 字段 `canvas.texts`。

- [ ] **Step 1: 导入 `TextBox` 类型**

把第 8 行的类型导入改为（追加 `TextBox`）：

```tsx
import type { Card, Connection, Section, CanvasLabel, TextBox } from '../types'
```

- [ ] **Step 2: `computeSelection` 支持文本框**

把 `computeSelection` 签名（约第 44–49 行）改为增加 `texts` 参数：

```tsx
function computeSelection(
  selRect: { x: number; y: number; w: number; h: number },
  cards: Card[],
  labels: CanvasLabel[],
  sections: Section[],
  texts: TextBox[],
): SelectionSet {
```

在该函数内、labels 的 `for` 循环（约第 59–64 行）之后插入：

```tsx
  for (const t of texts) {
    const th = t.height ?? 24
    if (rectsIntersect(selRect.x, selRect.y, selRect.w, selRect.h, t.x, t.y, t.width, th)) {
      sel.textIds.add(t.id)
    }
  }
```

- [ ] **Step 3: lasso 结束时把 texts 传入 `computeSelection`**

把 lasso `onUp` 中的取值与调用（约第 358–361 行）改为：

```tsx
        const curCards = canvas?.cards ?? []
        const curLabels = canvas?.labels ?? []
        const curSections = canvas?.sections ?? []
        const curTexts = canvas?.texts ?? []
        const sel = computeSelection(lassoRectRef.current, curCards, curLabels, curSections, curTexts)
```

- [ ] **Step 4: 按下时命中已选中文本框 → 进入群组拖动**

在 `handleMouseDown` 内、section 命中判定块（约第 423–431 行，以 `}` 结束的 `if (!hitSelected) { for (const sid of selection.sectionIds) {...} }`）之后插入：

```tsx
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

- [ ] **Step 5: `.closest('.canvas-text')` 防止在文本框上误开框选**

把 `handleMouseDown` 的 `.closest` 判定（约第 444 行）改为追加 `.canvas-text`：

```tsx
      if (target.closest('.note-card') || target.closest('.canvas-label') || target.closest('.canvas-text') || target.closest('.section-header') ||
          target.closest('.section-resize-handle') || target.closest('.card-resize-handle') ||
          target.closest('.conn-delete-btn') || target.closest('.canvas-toolbar')) return
```

把 `handleMouseDown` 的 `useCallback` 依赖数组（约第 453 行）加入 `texts`：

```tsx
  }, [connectingFrom, addConnection, selection, cards, labels, sections, texts, toCanvasCoords, startLassoListeners])
```

- [ ] **Step 6: 群组拖动 effect —— 记录文本框初始位置**

在群组拖动 effect 内、`const origSections = new Map...`（约第 494 行）之后增加：

```tsx
    const origTexts = new Map<string, { x: number; y: number }>()
```

在填充 `canvas0` 的 `for (const sec of canvas0.sections ?? [])` 块（约第 502–504 行）之后增加：

```tsx
      for (const t of canvas0.texts ?? []) {
        if (selection.textIds.has(t.id)) origTexts.set(t.id, { x: t.x, y: t.y })
      }
```

- [ ] **Step 7: 群组拖动 effect —— 「无卡片选中」分支平移文本框**

在「无卡片选中」分支（约第 518–535 行）里，`const updatedSections = ...` 之后、`useStore.setState({...})` 之前插入：

```tsx
          const updatedTexts = (canvas.texts ?? []).map((t) => {
            const orig = origTexts.get(t.id)
            return orig ? { ...t, x: orig.x + totalDx, y: orig.y + totalDy } : t
          })
```

并把该分支的 `useStore.setState` 写回对象（约第 527–533 行）改为带上 `texts`：

```tsx
          useStore.setState({
            canvases: store.canvases.map((c) =>
              c.id === store.activeCanvasId
                ? { ...c, labels: updatedLabels, sections: updatedSections, texts: updatedTexts }
                : c,
            ),
          })
```

- [ ] **Step 8: 群组拖动 effect —— 主分支平移文本框**

在主分支里，`const updatedSections = ...`（约第 588–591 行）之后插入：

```tsx
        const updatedTexts = (canvas.texts ?? []).map((t) => {
          const orig = origTexts.get(t.id)
          return orig ? { ...t, x: orig.x + finalDx, y: orig.y + finalDy } : t
        })
```

并把主分支的 `useStore.setState` 写回对象（约第 593–599 行）改为带上 `texts`：

```tsx
        useStore.setState({
          canvases: store.canvases.map((c) =>
            c.id === store.activeCanvasId
              ? { ...c, cards: updatedCards, labels: updatedLabels, sections: updatedSections, texts: updatedTexts }
              : c,
          ),
        })
```

- [ ] **Step 9: 类型检查**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

- [ ] **Step 10: 手动验证**

Run: `npm run dev`，在打开的应用中：
1. 创建若干卡片/标题/分区，并创建 2 个文本框。
2. 在画布空白处按住拖出一个框选矩形，覆盖部分卡片与文本框 → 松手后这些元素出现选中描边（文本框也有蓝色描边）。
3. 在任一被选中元素上按住拖动 → 选中的卡片、标题、文本框一起整体移动，相对位置不变。
4. 单独拖动一个**未**被框选的文本框仍正常（不会误触发框选）。
5. 点击空白处 → 选中态清除。

Expected: 以上全部符合预期。

- [ ] **Step 11: Commit**

```bash
git add src/components/CanvasView.tsx
git commit -m "$(cat <<'EOF'
feat: 文本框参与框选与群组拖动

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage（逐条对 spec §1 目标）：**
1. 右键「创建文本」+ 进入编辑 → Task 3 Step 4 / Task 1 `addText` 置 `editingTextId`。✅
2. 多行段落正文 → Task 2 textarea + `.text-content` `pre-wrap`。✅
3. 透明只有文字 → Task 2 CSS（无 border/background）。✅
4. 宽度可拖、高度自适应 → Task 2 `handleResizeStart` + `autoGrow` + ResizeObserver。✅
5. 双击编辑 / Esc / 点外部退出 / 回车换行 → Task 2 `handleClick`、`onKeyDown` Escape、`onBlur`、textarea 默认 Enter。✅
6. 单独拖动 / 删除 → Task 2 `handleDragStart` / 删除按钮。✅
7. 框选 + 群组拖动 → Task 4 全部步骤。✅
8. 持久化 + 同步无需改引擎 → Task 1 actions 均 `get().persist()`；`texts` 随 canvas 序列化。✅
- spec §3「`texts` 不计入同步实体计数」→ 本计划未改 `summarizeSyncData`，符合（即不计入）。✅
- spec §7 空文本框保留 → `commitEdit` 不删除空文本。✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤均含完整代码与确切命令。✅

**Type consistency：** `TextBox` 字段（id/text/x/y/width/height?/sourceId?）在 types/store/component/CanvasView 用法一致；action 名 `addText/updateText/deleteText/moveText/setEditingText` 全程一致；`SelectionSet.textIds`、`useActiveTexts`、`editingTextId` 命名一致；`computeSelection` 新增第 5 参 `texts` 与调用点一致。✅
