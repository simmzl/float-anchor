# 设计文档：快捷键集中登记表 + 设置内速查面板

- 日期：2026-06-24
- 分支：`feat/add-text-box`（继续累积；依赖已完成的画布快捷键 + 菜单标记功能）
- 状态：已批准（方案 A，待 spec 复审）

## 1. 背景与目标

已有画布快捷键 + 右键菜单快捷键标记，但快捷键定义散在两处（CanvasView 的 keydown 分发 + 菜单标记 `SC` 常量）。现在要：
1. 把**自动排布**从 `⌘⇧L`/`Ctrl+Shift+L` 改成**裸键 `L`**。
2. 在**设置面板**加一节「键盘快捷键」，列出全部快捷键（平台自适应）。

借此建一个**集中的快捷键登记表**作单一数据源，供菜单标记与速查面板共用，减少漂移。

### 目标
1. 自动排布快捷键 = 裸键 `L`（无修饰键）；菜单标记同步显示 `L`。
2. 设置面板（齿轮）内出现「键盘快捷键」一节，列出全部 12 条快捷键，平台自适应（Mac 用 ⌘/⇧/⏎/⌫ 符号，Win 用文本）。
3. 菜单标记与面板都从同一登记表取值。

### 非目标（YAGNI）
- 不加 `?` 键打开面板（入口走设置）。
- keydown 分发不做成全数据驱动——仍是命令式逻辑，仅键位**展示串**来自登记表；keydown 处加注释提醒与登记表同步。
- 不改数据模型/类型 schema。

## 2. 架构

### 2.1 新建单一数据源 `src/shortcuts.ts`
```ts
export const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

export interface ShortcutDef {
  id: string
  label: string
  mac: string
  win: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'card',      label: '新建卡片',          mac: 'C',   win: 'C' },
  { id: 'text',      label: '新建文本',          mac: 'T',   win: 'T' },
  { id: 'section',   label: '新建分区',          mac: 'R',   win: 'R' },
  { id: 'arrange',   label: '自动排布选中',      mac: 'L',   win: 'L' },
  { id: 'selectAll', label: '全选',              mac: '⌘A',  win: 'Ctrl+A' },
  { id: 'edit',      label: '编辑选中（单选时）', mac: '⏎',   win: 'Enter' },
  { id: 'delete',    label: '删除选中',          mac: '⌫',   win: 'Del' },
  { id: 'nudge',     label: '微移选中（⇧ 大步）', mac: '方向键', win: '方向键' },
  { id: 'zoomIn',    label: '放大',              mac: '⌘+',  win: 'Ctrl +' },
  { id: 'zoomOut',   label: '缩小',              mac: '⌘-',  win: 'Ctrl -' },
  { id: 'zoomReset', label: '缩放复位',          mac: '⌘0',  win: 'Ctrl 0' },
  { id: 'deselect',  label: '取消选择 / 退出连线', mac: 'Esc', win: 'Esc' },
]

export function scKey(id: string): string {
  const s = SHORTCUTS.find((x) => x.id === id)
  return s ? (IS_MAC ? s.mac : s.win) : ''
}
```

### 2.2 `CanvasView.tsx`
- 删除现有模块级 `IS_MAC` 与 `SC` 常量（含其上方注释），改为 `import { scKey } from '../shortcuts'`。
- 6 个菜单项的 `shortcut` 值由 `SC.xxx` 改为 `scKey('xxx')`：
  - 自动排布 → `scKey('arrange')`、编辑 → `scKey('edit')`、删除 → `scKey('delete')`、创建空白卡片 → `scKey('card')`、创建文本 → `scKey('text')`、创建分区 → `scKey('section')`。
- **自动排布键改裸键 L**：keydown 分发里删掉 `if (mod && e.shiftKey && k === 'l') {...}` 分支；在非 mod 段（c/t/r 旁）加：
  ```ts
  if (k === 'l') { e.preventDefault(); arrangeUnits(selIds()); return }
  ```
  - 选中 <2 时 `arrangeUnits` 内部已兜底 no-op。
  - 位置：放在 `k==='c'/'t'/'r'` 之后、`Enter` 之前。`preventDefault` 可有可无（裸字母），为一致性保留。
- keydown effect 顶部加注释：「键位若改动，需同步 src/shortcuts.ts 的展示串」。

### 2.3 `SettingsModal.tsx`
- `import { SHORTCUTS, scKey } from '../shortcuts'`。
- 在「外观」`.settings-section` 之后插入一个新 `.settings-section`：
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
- 纯展示，无交互逻辑。

### 2.4 `index.css`
新增设置内快捷键列表样式：
```css
.shortcut-list { display: flex; flex-direction: column; gap: 2px; }
.shortcut-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
}
.shortcut-row:last-child { border-bottom: none; }
.shortcut-label { font-size: 13px; color: var(--text-primary); }
.shortcut-key {
  font-family: var(--font);
  font-size: 12px; letter-spacing: 0.5px;
  color: var(--text-secondary);
  padding: 2px 8px;
  background: var(--sidebar-hover);
  border-radius: var(--radius-sm);
}
```
（菜单标记 `.context-menu-shortcut` 已用系统字体，保持现状不动。）

## 3. 边界
- 平台判断 `navigator.platform`（Electron 渲染进程可用），判断不出默认 Win 文本。
- 登记表是展示层数据源；keydown 的实际触发逻辑独立维护（注释提醒同步）。
- 自动排布裸键 `L`：与新建 C/T/R 一致是裸字母；编辑态/弹窗打开时被既有守卫挡住，不会变打字。
- 老数据/无关：纯 UI，不碰数据与同步。

## 4. 验证
项目无测试框架，门禁 `npx tsc -p tsconfig.json`（noEmit）+ `npm run build`，外加手动验证：
1. tsc、build 通过。
2. 非编辑态选中 ≥2 元素按 `L` → 自动排布生效（原 `⌘⇧L` 不再触发）。
3. 选区右键「自动排布」标记显示 `L`。
4. 设置（齿轮）→ 「键盘快捷键」一节列出全部 12 条，键位平台自适应、样式整齐。
5. 其它快捷键（C/T/R、⌘A、Enter、Delete、方向键、缩放、Esc）行为无回归；菜单其它标记（C/T/R/⏎/⌫）正常。
6. 编辑卡片/文本时按 `L` 只是打字，不触发排布。

## 5. 受影响文件
- 新建 `src/shortcuts.ts`：`IS_MAC` / `ShortcutDef` / `SHORTCUTS` / `scKey`。
- `src/components/CanvasView.tsx`：删本地 `IS_MAC`/`SC`，import `scKey`；6 菜单项改 `scKey(...)`；自动排布键改裸 `L`；keydown 注释。
- `src/components/SettingsModal.tsx`：import 登记表；新增「键盘快捷键」section。
- `src/index.css`：新增 `.shortcut-list`/`.shortcut-row`/`.shortcut-label`/`.shortcut-key`。
- （无新类型 schema、无数据改动。）
