# 快捷键集中登记表 + 设置内速查面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立集中的快捷键登记表（单一数据源），自动排布改裸键 `L`，并在设置面板加一节列出全部快捷键。

**Architecture:** 新建 `src/shortcuts.ts` 作单一数据源；CanvasView 菜单标记改用 `scKey(...)` 并把自动排布键改为裸 `L`；SettingsModal 新增「键盘快捷键」section 渲染登记表。单一内聚改动，作为一个 Task。

**Tech Stack:** React 18 + TypeScript + Electron。

## Global Constraints

- 自动排布快捷键 = **裸键 `L`**（无修饰键）；登记表与菜单标记均显示 `L`。
- 登记表是展示层单一数据源；keydown 实际分发仍命令式，仅展示串来自登记表。
- 平台判断 `/mac/i.test(navigator.platform)`，判断不出默认 Win 文本。
- 菜单标记 6 项改用 `scKey('card'|'text'|'section'|'arrange'|'edit'|'delete')`；删除本地 `IS_MAC`/`SC` 常量。
- 设置「键盘快捷键」节列出全部 12 条，纯展示。
- 不加 `?` 键；不做全数据驱动 keydown；不改数据/类型 schema、不加依赖。
- 项目无测试框架，门禁 `npx tsc -p tsconfig.json`（noEmit；node_modules 已装）+ `npm run build`。
- Electron GUI 手测留人工；subagent 跳过 GUI 手测，不因此报 BLOCKED。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: 快捷键登记表 + 自动排布裸键 L + 设置面板

**Files:**
- Create: `src/shortcuts.ts`
- Modify: `src/components/CanvasView.tsx`（删 `IS_MAC`/`SC`，import `scKey`；6 菜单项改 `scKey`；自动排布键改裸 `L`）
- Modify: `src/components/SettingsModal.tsx`（import 登记表；新增「键盘快捷键」section）
- Modify: `src/index.css`（新增快捷键列表样式）

**Interfaces:**
- Produces：`src/shortcuts.ts` 导出 `IS_MAC: boolean`、`ShortcutDef`、`SHORTCUTS: ShortcutDef[]`、`scKey(id: string): string`。

- [ ] **Step 1: 创建 `src/shortcuts.ts`**

```ts
export const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export interface ShortcutDef {
  id: string
  label: string
  mac: string
  win: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'card', label: '新建卡片', mac: 'C', win: 'C' },
  { id: 'text', label: '新建文本', mac: 'T', win: 'T' },
  { id: 'section', label: '新建分区', mac: 'R', win: 'R' },
  { id: 'arrange', label: '自动排布选中', mac: 'L', win: 'L' },
  { id: 'selectAll', label: '全选', mac: '⌘A', win: 'Ctrl+A' },
  { id: 'edit', label: '编辑选中（单选时）', mac: '⏎', win: 'Enter' },
  { id: 'delete', label: '删除选中', mac: '⌫', win: 'Del' },
  { id: 'nudge', label: '微移选中（⇧ 大步）', mac: '方向键', win: '方向键' },
  { id: 'zoomIn', label: '放大', mac: '⌘+', win: 'Ctrl +' },
  { id: 'zoomOut', label: '缩小', mac: '⌘-', win: 'Ctrl -' },
  { id: 'zoomReset', label: '缩放复位', mac: '⌘0', win: 'Ctrl 0' },
  { id: 'deselect', label: '取消选择 / 退出连线', mac: 'Esc', win: 'Esc' },
]

export function scKey(id: string): string {
  const s = SHORTCUTS.find((x) => x.id === id)
  return s ? (IS_MAC ? s.mac : s.win) : ''
}
```

- [ ] **Step 2: `CanvasView.tsx` —— 删本地常量、import scKey**

删除现有第 15–19 行：

```tsx
// 右键菜单快捷键标记。注意：键位若改动，需与本文件 keydown effect 中的分发保持一致。
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const SC = IS_MAC
  ? { card: 'C', text: 'T', section: 'R', arrange: '⌘⇧L', edit: '⏎', del: '⌫' }
  : { card: 'C', text: 'T', section: 'R', arrange: 'Ctrl+Shift+L', edit: 'Enter', del: 'Del' }
```

在 `import type { MenuItem } from './ContextMenu'`（第 11 行）之后加：

```tsx
import { scKey } from '../shortcuts'
```

- [ ] **Step 3: `CanvasView.tsx` —— 6 菜单项改 scKey**

逐项替换（按当前各行）：
- `shortcut: SC.arrange,` → `shortcut: scKey('arrange'),`
- `shortcut: SC.edit,` → `shortcut: scKey('edit'),`
- `shortcut: SC.del,` → `shortcut: scKey('delete'),`
- `shortcut: SC.card,` → `shortcut: scKey('card'),`
- `shortcut: SC.text,` → `shortcut: scKey('text'),`
- `shortcut: SC.section,` → `shortcut: scKey('section'),`

（注意 `SC.del` 对应登记表 id `'delete'`。）

- [ ] **Step 4: `CanvasView.tsx` —— 自动排布改裸键 L**

删除现有的 mod+shift+L 分支（约第 736–740 行）：

```tsx
      if (mod && e.shiftKey && k === 'l') {
        e.preventDefault()
        arrangeUnits(selIds())
        return
      }
```

在 c/t/r 三行（`if (k === 'r') {...}`，约第 753 行）之后插入：

```tsx
      if (k === 'l') { e.preventDefault(); arrangeUnits(selIds()); return }
```

- [ ] **Step 5: `SettingsModal.tsx` —— import + 新增 section**

在 `import type { ... } from '../types'`（第 3 行）之后加：

```tsx
import { SHORTCUTS, scKey } from '../shortcuts'
```

在「软件更新」section（即 `<div className="settings-section">` 紧跟 `<h3>软件更新</h3>` 那块）**之前**插入新 section：

```tsx
        <div className="settings-section">
          <h3>键盘快捷键</h3>
          <div className="shortcut-list">
            {SHORTCUTS.map((s) => (
              <div className="shortcut-row" key={s.id}>
                <span className="shortcut-label">{s.label}</span>
                <span className="shortcut-key">{scKey(s.id)}</span>
              </div>
            ))}
          </div>
        </div>

```

- [ ] **Step 6: `index.css` —— 快捷键列表样式**

在文件末尾追加：

```css
/* ===== Settings: Keyboard Shortcuts ===== */
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
}

.shortcut-row:last-child {
  border-bottom: none;
}

.shortcut-label {
  font-size: 13px;
  color: var(--text-primary);
}

.shortcut-key {
  font-family: var(--font);
  font-size: 12px;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  padding: 2px 8px;
  background: var(--sidebar-hover);
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 7: 类型检查 + 构建**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

Run: `npm run build`
Expected: 末尾三段 `✓ built`，无 error。

- [ ] **Step 8: 手动验证（Electron GUI，由人执行；subagent 跳过）**

Run: `npm run dev`：
1. 选中 ≥2 元素按 `L` → 自动排布生效；`⌘⇧L` 不再触发。
2. 选区右键「自动排布」标记显示 `L`。
3. 齿轮 → 设置 → 「键盘快捷键」节列出全部 12 条，键位平台自适应、样式整齐。
4. C/T/R、⌘A、Enter、Delete、方向键、缩放、Esc 行为无回归；菜单 C/T/R/⏎/⌫ 标记正常。
5. 编辑卡片/文本时按 `L` 只是打字、不触发排布。

- [ ] **Step 9: Commit**

```bash
git add src/shortcuts.ts src/components/CanvasView.tsx src/components/SettingsModal.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat: 快捷键集中登记表 + 自动排布改裸键L + 设置内速查面板

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage：**
- shortcuts.ts 登记表 + scKey → Step 1。✅
- 自动排布裸键 L → Step 4（keydown）+ 登记表 arrange=L（Step 1）。✅
- 菜单标记改 scKey、删本地 SC → Step 2/3。✅
- 设置「键盘快捷键」节列出 12 条 → Step 5 + 样式 Step 6。✅
- 平台自适应 → scKey/IS_MAC（Step 1）。✅

**Placeholder scan：** 无 TBD/TODO；每步含完整代码与确切命令。✅

**Type consistency：** `scKey(id)`/`SHORTCUTS`/`ShortcutDef`/`IS_MAC` 在 shortcuts.ts 定义、CanvasView/SettingsModal 使用一致；`SC.del` → `scKey('delete')` 映射正确（id 为 'delete'）；CSS 类 `.shortcut-list/-row/-label/-key` 在 JSX 与 CSS 一致。✅
