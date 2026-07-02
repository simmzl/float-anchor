import { readFileSync, readSync } from 'node:fs'
import type { AppData } from '../types'
import { resolveDataFile, loadAppData, saveAppData, AppRunningError } from '../core/appdata'
// 写盘前统一走 normalizeSyncData，使落盘数据已是 Electron 同步层的规范形态（含 _syncTimestamp），
// 保证「读出来再 normalize 一次」是幂等的（round-trip guard，见 run.test.ts）。
import { normalizeSyncData } from '../../../electron/sync/summary'

export interface GlobalOpts { data?: string; json?: boolean; force?: boolean; yes?: boolean }
export interface Ctx { file: string; data: AppData; opts: GlobalOpts }

export function readContent(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value === '-') return readFileSync(0, 'utf-8') // fd 0 = stdin
  return value
}

export function output(json: boolean | undefined, human: string, payload: unknown): void {
  if (json) console.log(JSON.stringify(payload, null, 2))
  else console.log(human)
}

export function fail(code: number, msg: string, json?: boolean): never {
  if (json) console.error(JSON.stringify({ error: msg }))
  else console.error(msg)
  process.exit(code)
}

export function withData(opts: GlobalOpts): Ctx {
  const file = resolveDataFile(opts.data)
  try {
    return { file, data: loadAppData(file), opts }
  } catch (e) {
    fail(4, (e as Error).message, opts.json) // 坏 JSON / 缺目录 → 退出码 4
  }
}

export function commit(ctx: Ctx, next: AppData): void {
  try {
    saveAppData(ctx.file, normalizeSyncData(next) as AppData, { force: ctx.opts.force })
  } catch (e) {
    if (e instanceof AppRunningError) fail(3, `${e.message}（如确认要写，请加 --force）`, ctx.opts.json)
    fail(4, `写入失败：${(e as Error).message}`, ctx.opts.json)
  }
}

export function resolveCanvasRef(ctx: Ctx, explicit?: string): string {
  if (explicit) return explicit
  if (ctx.data.activeCanvasId) return ctx.data.activeCanvasId
  fail(2, '未指定 --canvas 且没有活动画布', ctx.opts.json)
}

// 同步读一行（用于 TTY 下的删除二次确认）。提示写到 stderr，保持 stdout(--json) 干净。
function promptLine(question: string): string {
  process.stderr.write(question)
  const buf = Buffer.alloc(1)
  let input = ''
  for (;;) {
    let n = 0
    try { n = readSync(0, buf, 0, 1, null) } catch { break }
    if (n === 0) break
    const ch = buf.toString('utf-8')
    if (ch === '\n') break
    if (ch !== '\r') input += ch
  }
  return input.trim()
}

// rm 类命令的删除二次确认：
//   --yes            → 放行（显式确认，agent/脚本走这条）
//   TTY 且无 --yes   → 交互 [y/N] 确认，非 y 则取消
//   非 TTY 且无 --yes → 拒绝（退出码 1），防 agent/脚本/管道静默误删
export function confirmDelete(ctx: Ctx, kind: string): void {
  if (ctx.opts.yes) return
  if (!process.stdin.isTTY) fail(1, `删除${kind}需加 --yes 确认（非交互环境不弹提示）`, ctx.opts.json)
  const ans = promptLine(`确定删除该${kind}？[y/N] `).toLowerCase()
  if (ans !== 'y' && ans !== 'yes') { console.error('已取消'); process.exit(0) }
}

// 数字入参校验：非法数字（如 "abc"、"12px"）不能静默变成 NaN → JSON.stringify(NaN) === 'null' 写脏数据文件。
export function num(v: string | undefined, name: string, json?: boolean): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) fail(1, `选项 ${name} 需要数字，收到「${v}」`, json)
  return n
}

// --level 入参校验：只接受 0..4 的整数。
export function level(v: string | undefined, json?: boolean): (0 | 1 | 2 | 3 | 4) | undefined {
  if (v == null) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 4) fail(1, `--level 需要 0..4 的整数，收到「${v}」`, json)
  return n as 0 | 1 | 2 | 3 | 4
}
