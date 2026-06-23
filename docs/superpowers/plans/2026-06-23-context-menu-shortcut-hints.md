# 右键菜单快捷键标记 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 右键菜单中有对应快捷键的菜单项，在右侧显示平台自适应的快捷键标记。

**Architecture:** `MenuItem` 加可选 `shortcut?: string`；`ContextMenu` 右对齐渲染该标记；`CanvasView` 用模块级平台自适应常量 `SC` 给 6 个菜单项填 `shortcut`；`index.css` 加一个标记样式类。单一内聚改动，作为一个 Task。

**Tech Stack:** React 18 + TypeScript + Electron。

## Global Constraints

- 标记映射：创建空白卡片=`C`、创建文本=`T`、创建分区=`R`（Mac/Win 同）；自动排布=`⌘⇧A`(mac)/`Ctrl+Shift+A`(win)；编辑=`⏎`(mac)/`Enter`(win)；删除=`⌫`(mac)/`Del`(win)。
- 仅这 6 项加标记；创建标题/最佳大小/拷贝链接/移动到/连接/分区最佳大小**不加**。
- 平台判断：`/mac/i.test(navigator.platform)`，判断不出默认 Win 文本分支。
- 标记右对齐（`margin-left:auto`）、淡色（`--text-muted`）、等宽（`--mono`）、小字号；danger 项标记用 danger 色。
- 纯展示，不改任何点击行为/快捷键行为；无新类型、无数据改动。
- 在 `SC` 常量处加注释提醒"与 keydown effect 保持一致"。
- 项目无测试框架，门禁 `npx tsc -p tsconfig.json`（noEmit；node_modules 已装）+ `npm run build`。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Electron GUI 手动验证留人工执行；subagent 跳过 GUI 手测，不因此报 BLOCKED。

---

### Task 1: 右键菜单快捷键标记

**Files:**
- Modify: `src/components/ContextMenu.tsx`（`MenuItem` 加 `shortcut?`；渲染追加标记 span）
- Modify: `src/components/CanvasView.tsx`（模块级 `IS_MAC`/`SC` 常量；6 个菜单项加 `shortcut`）
- Modify: `src/index.css`（新增 `.context-menu-shortcut` + danger 变体）

**Interfaces:**
- Produces：`MenuItem.shortcut?: string`（可选字段，已有消费方仅 CanvasView 自身）。

- [ ] **Step 1: `ContextMenu.tsx` —— `MenuItem` 加 `shortcut?`**

把 `MenuItem` 接口（约第 3–8 行）：

```tsx
export interface MenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  onClick: () => void
}
```

改为：

```tsx
export interface MenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  shortcut?: string
  onClick: () => void
}
```

- [ ] **Step 2: `ContextMenu.tsx` —— 渲染标记**

把渲染中的：

```tsx
          {item.icon && <span className="context-menu-icon">{item.icon}</span>}
          <span>{item.label}</span>
```

改为（在 label 后追加 shortcut span）：

```tsx
          {item.icon && <span className="context-menu-icon">{item.icon}</span>}
          <span>{item.label}</span>
          {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
```

- [ ] **Step 3: `CanvasView.tsx` —— 模块级平台常量**

在 `const MAX_SCALE = 3`（约第 13 行）之后插入：

```tsx
// 右键菜单快捷键标记。注意：键位若改动，需与本文件 keydown effect 中的分发保持一致。
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const SC = IS_MAC
  ? { card: 'C', text: 'T', section: 'R', arrange: '⌘⇧A', edit: '⏎', del: '⌫' }
  : { card: 'C', text: 'T', section: 'R', arrange: 'Ctrl+Shift+A', edit: 'Enter', del: 'Del' }
```

- [ ] **Step 4: `CanvasView.tsx` —— 选区菜单「自动排布」加标记**

在 `label: '自动排布',`（约第 818 行）下一行插入：

```tsx
            shortcut: SC.arrange,
```

- [ ] **Step 5: `CanvasView.tsx` —— 卡片菜单「编辑」「删除」加标记**

在 `label: '编辑',`（约第 891 行）下一行插入：

```tsx
            shortcut: SC.edit,
```

在 `label: '删除',`（约第 896 行）下一行插入：

```tsx
            shortcut: SC.del,
```

- [ ] **Step 6: `CanvasView.tsx` —— 空白菜单三项加标记**

在 `label: '创建空白卡片',` 下一行插入：

```tsx
              shortcut: SC.card,
```

在 `label: '创建文本',` 下一行插入：

```tsx
              shortcut: SC.text,
```

在 `label: '创建分区',` 下一行插入：

```tsx
              shortcut: SC.section,
```

（注意：`label: '创建标题',` **不加** shortcut。）

- [ ] **Step 7: `index.css` —— 标记样式**

在 `.context-menu-item.danger .context-menu-icon { ... }` 规则（约第 1558–1560 行）之后插入：

```css
.context-menu-shortcut {
  margin-left: auto;
  padding-left: 16px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
}

.context-menu-item.danger .context-menu-shortcut {
  color: var(--danger);
  opacity: 0.75;
}
```

- [ ] **Step 8: 类型检查 + 构建**

Run: `npx tsc -p tsconfig.json`
Expected: 无输出（退出码 0）。

Run: `npm run build`
Expected: 末尾三段 `✓ built`，无 error。

- [ ] **Step 9: 手动验证（Electron GUI，由人执行；subagent 跳过）**

Run: `npm run dev`：
1. 空白右键 → 创建空白卡片/文本/分区 右侧显示 `C`/`T`/`R`；创建标题无标记。
2. 卡片右键 → 编辑显示 `⏎`(mac)/`Enter`，删除显示 `⌫`/`Del`（danger 色）；其余项无标记。
3. 框选 ≥2 → 选区右键 → 自动排布显示 `⌘⇧A`/`Ctrl+Shift+A`。
4. 标记右对齐、淡色、不影响点击；各菜单项点击行为正常。

- [ ] **Step 10: Commit**

```bash
git add src/components/ContextMenu.tsx src/components/CanvasView.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat: 右键菜单显示快捷键标记

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage：**
- MenuItem.shortcut + 右对齐渲染 → Step 1/2 + Step 7 CSS。✅
- 平台自适应 SC 常量 → Step 3。✅
- 6 项标记（自动排布/编辑/删除/创建卡片/文本/分区）→ Step 4/5/6，映射值与 spec §2 一致。✅
- 创建标题等不加 → Step 6 注明。✅
- danger 项标记色 → Step 7。✅
- SC 与 keydown 一致性注释 → Step 3。✅

**Placeholder scan：** 无 TBD/TODO；每步含完整代码与确切命令。✅

**Type consistency：** `shortcut?: string` 在 ContextMenu 定义、CanvasView 使用一致；`SC` 字段名 card/text/section/arrange/edit/del 在定义与 6 处引用一致；`.context-menu-shortcut` 类在 CSS 与渲染一致。✅
