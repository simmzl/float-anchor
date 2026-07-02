#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { registerCanvas } from './commands/canvas'
import { registerCard } from './commands/card'
import { registerText } from './commands/text'
import { registerLabel } from './commands/label'
import { registerSection } from './commands/section'
import { registerConnect } from './commands/connect'

export function buildProgram(): Command {
  const program = new Command()
  program.name('fa').description('FloatAnchor 命令行工具')
    .option('--data <path>', '指定数据文件（覆盖默认路径与 FA_DATA）')
    .option('--json', '输出 JSON')
    .option('--force', 'App 运行时仍写入')
    .option('--yes', '跳过删除确认')
  registerCanvas(program)
  registerCard(program)
  registerText(program)
  registerLabel(program)
  registerSection(program)
  registerConnect(program)
  return program
}

// 是否作为可执行入口运行。必须用 realpath 归一化再比较：npm 全局安装的 `fa` 是软链
// （argv[1] = bin/fa 软链，import.meta.url = 解析后的真实 dist/fa.js），裸字符串比较永不相等，
// 会导致装好的 fa 什么都不做。realpathSync 把两侧都解到真实路径再比。
export function isEntrypoint(argv1: string | undefined, metaUrl: string): boolean {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(metaUrl)
  } catch {
    return false
  }
}

// 直接运行时执行（测试里改用 buildProgram + parseAsync，不会触发这里）
if (isEntrypoint(process.argv[1], import.meta.url)) {
  buildProgram().parseAsync(process.argv).catch((e) => { console.error(e.message); process.exit(1) })
}
