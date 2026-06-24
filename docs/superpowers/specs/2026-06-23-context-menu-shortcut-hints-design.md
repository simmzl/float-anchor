# 设计文档：右键菜单快捷键标记（Context Menu Shortcut Hints）

- 日期：2026-06-23
- 分支：`feat/add-text-box`（继续在同分支；依赖刚完成的画布快捷键功能）
- 状态：已批准（待 spec 复审）

## 1. 背景与目标

刚加了一套画布快捷键（C/T/R 新建、⌘⇧L 自动排布、Enter 编辑、Delete 删除等）。右键菜单里这些操作目前没有任何快捷键提示。

本功能：**在右键菜单中，凡有对应快捷键的菜单项，在其右侧显示该快捷键标记**（类似 macOS 菜单里 "⌘C" 的样式），平台自适应。

### 目标
1. 有快捷键的菜单项右侧出现淡色快捷键标记，右对齐。
2. 标记平台自适应（Mac 用 ⌘/⇧/⏎/⌫ 符号，Win 用 Ctrl+Shift+.../Enter/Del 文本）。
3. 没有快捷键的项不显示标记。

### 非目标（YAGNI）
- 不做集中式 keymap 注册表重构（键盘分发与菜单标记暂各自维护，见 §5）。
- 不改任何快捷键行为，不加新快捷键。
- 不为「创建标题 / 最佳大小 / 拷贝链接 / 移动到 / 连接 / 分区最佳大小」加标记（它们无快捷键）。

## 2. 标记映射（平台自适应）

| 菜单项 | 所在菜单 | Mac | Win |
|---|---|---|---|
| 创建空白卡片 | 空白右键 | `C` | `C` |
| 创建文本 | 空白右键 | `T` | `T` |
| 创建分区 | 空白右键 | `R` | `R` |
| 自动排布 | 选区右键（≥2 选中） | `⌘⇧L` | `Ctrl+Shift+L` |
| 编辑 | 卡片右键 | `⏎` | `Enter` |
| 删除 | 卡片右键 | `⌫` | `Del` |

> 已知语义差异（保留，不处理）：卡片右键「删除」是**点击立即删除**，而键盘 `⌫/Del` 走**二次确认弹窗**。标记表示"该动作的快捷键"，用户已确认接受在「删除」上显示此标记。

## 3. 架构

### 3.1 `ContextMenu` 组件（`src/components/ContextMenu.tsx`）
- `MenuItem` 接口新增可选字段 `shortcut?: string`。
- 渲染：在 `<span>{item.label}</span>` 之后追加
  `{item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}`。
- `.context-menu-item` 已是 `display:flex; align-items:center`，标记用 `margin-left:auto` 右推即可。

### 3.2 `CanvasView`（`src/components/CanvasView.tsx`）
- 模块级常量（平台判断一次）：
  ```ts
  const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const SC = IS_MAC
    ? { card: 'C', text: 'T', section: 'R', arrange: '⌘⇧L', edit: '⏎', del: '⌫' }
    : { card: 'C', text: 'T', section: 'R', arrange: 'Ctrl+Shift+L', edit: 'Enter', del: 'Del' }
  ```
- 在 `handleContextMenu` 构建菜单项时，为下列 6 项各加一行 `shortcut: SC.xxx`：
  - 选区菜单「自动排布」→ `shortcut: SC.arrange`
  - 卡片菜单「编辑」→ `shortcut: SC.edit`；「删除」→ `shortcut: SC.del`
  - 空白菜单「创建空白卡片」→ `SC.card`；「创建文本」→ `SC.text`；「创建分区」→ `SC.section`
- 其余菜单项不加 `shortcut`。

### 3.3 CSS（`src/index.css`）
在 `.context-menu-icon` 相关规则附近新增：
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

## 4. 边界
- 平台判断 `navigator.platform`（Electron 渲染进程可用）。判断不出（极端）默认走 Win 文本分支，仍可读。
- 标记纯展示，不影响点击行为。
- 菜单项 label 较长 + 标记时，`.context-menu` 有 `min-width`，`margin-left:auto` 保证标记右对齐、与 label 间至少 16px 间距。

## 5. 维护说明（有意取舍）
键盘分发（CanvasView keydown effect）与菜单标记（`SC` 常量）目前是**两处独立维护**的字符串。改快捷键时需同步两处。引入"动作→键位"中央注册表可消除重复，但属更大重构，本次 YAGNI 不做；在 `SC` 常量处加注释提醒"与 keydown effect 保持一致"。

## 6. 验证
项目无测试框架，门禁 `npx tsc -p tsconfig.json`（noEmit）+ `npm run build`，外加手动验证：
1. tsc、build 通过。
2. 空白处右键 → 「创建空白卡片/文本/分区」右侧分别显示 `C`/`T`/`R`；「创建标题」无标记。
3. 卡片右键 → 「编辑」显示 `⏎`(mac)/`Enter`(win)、「删除」显示 `⌫`/`Del`（红色调）；其余项无标记。
4. 框选 ≥2 → 选区右键 → 「自动排布」显示 `⌘⇧L`/`Ctrl+Shift+L`。
5. 标记右对齐、淡色、等宽字体，不影响点击。
6. 现有菜单项点击行为无回归。

## 7. 受影响文件
- `src/components/ContextMenu.tsx`：`MenuItem` 加 `shortcut?`；渲染追加标记 span。
- `src/components/CanvasView.tsx`：模块级 `IS_MAC`/`SC` 常量；6 个菜单项加 `shortcut`。
- `src/index.css`：新增 `.context-menu-shortcut`（+ danger 变体）。
- （无新类型、无数据改动。）
