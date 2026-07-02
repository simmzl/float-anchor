#!/usr/bin/env node
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

// 直接运行时执行（测试里改用 buildProgram + parseAsync）
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  buildProgram().parseAsync(process.argv).catch((e) => { console.error(e.message); process.exit(1) })
}
