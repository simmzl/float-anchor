---
name: floatanchor-cli
description: Use when the user wants to programmatically create or batch-generate FloatAnchor canvas content — cards, text boxes, sections, labels, connections — via the `fa` command-line tool. Example triggers "把这堆文本批量生成卡片", "用 fa 建画布并批量加卡片", "batch-create FloatAnchor cards".
---

# FloatAnchor CLI (`fa`)

`fa` 直接编辑 FloatAnchor 桌面 App 的本地数据文件，用于从命令行创建 / 批量生成画布内容（例如把一堆文本变成很多张卡片）。

## 数据模型

一份数据文件含多个 **canvas（画布）**。每个画布含五类元素，都用像素 `x`/`y` 定位：

- **card 卡片** — `title`、`content`(markdown)、`x`、`y`、`width`、可选 `height`
- **text 文本框** — `text` + 几何
- **section 分区** — `name`、`color` + 几何
- **label 标签(标题)** — `text`、`level`(0–4) + 几何
- **connection 连线** — 两张卡片之间的箭头（按卡片 id）

## 核心工作流：读 → 改 → 验

先用 `--json` 拿 id，再改，再读回确认：

    fa --json canvas ls                      # 列画布，取目标的 "id"
    fa --json card ls --canvas <canvasId>    # 列某画布的卡片，取 card id
    fa card add --canvas <canvasId> --title "标题" --content "正文"
    fa --json card ls --canvas <canvasId>    # 验证

引用任何元素用它的完整 **id**（来自 `--json`）；画布还可用唯一 `name` 引用。脚本里优先用 id。

## 批量生成（主用例）

把 N 段文本变成 N 张卡片：循环 `card add`。长 markdown 用 `--content -` 从 stdin 传（避免转义问题）。不给 `--x`/`--y` 时 `fa` 会把新元素自动放到现有内容右侧。

    # 1) 建画布（或用已有画布的 id / 名字）；输出里带新画布 id
    fa canvas create "我的画布"        # → ✓ 已新建画布「我的画布」(dfdc6c7a)
    # 2) 逐条加卡片，长正文走 stdin
    printf '# 标题一\n\n正文…' | fa --force card add --canvas "我的画布" --title "卡片一" --content -
    printf '# 标题二\n\n正文…' | fa --force card add --canvas "我的画布" --title "卡片二" --content -

其余创建同形状：`fa text add`、`fa section add --name X --color '#60a5fa'`、`fa label add --text X --level 2`、`fa connect add --from <cardId> --to <cardId>`。精确选项见 `fa <entity> --help`。

## 必须告知用户（并发）

`fa` 写的是桌面 App 内存里同一份文件，而 App **不监听该文件**，所以：

1. **App 通常开着**：不加 `--force` 的写会以**退出码 3** 拒绝（`FloatAnchor 桌面 App 正在运行…`）。加 **`--force`** 强制写。
2. **跑批前告诉用户：期间不要在 FloatAnchor 里操作** —— 否则 App 的下一次保存会覆盖 `fa` 的改动。
3. **跑批后告诉用户重启 FloatAnchor** 才能看到结果（App 只在启动时读文件）。

## 退出码（据此判定失败）

- `0` 成功
- `1` 用法 / 坏输入（如 `--x abc`、`--level 9` —— 需要数字）
- `2` 引用未找到或歧义
- `3` App 运行中、写被拒 → 加 `--force` 重试
- `4` 数据读写错误

## 指定数据文件

默认用 App 的数据文件。可用 `--data <path>` 或 `FA_DATA` 环境变量覆盖（便于先生成到临时文件）。

## 完整参考

`fa --help`、`fa <entity> --help`、`fa <entity> <verb> --help`。
