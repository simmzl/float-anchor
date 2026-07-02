import { readFileSync } from 'node:fs'
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

// rm 类命令的删除确认：--yes 或非 TTY（脚本/测试）→ 直接放行；TTY 且无 --yes → 交互确认缺失，拒绝。
export function confirmDelete(ctx: Ctx): void {
  if (ctx.opts.yes) return
  if (!process.stdin.isTTY) return
  fail(1, '请加 --yes 确认删除', ctx.opts.json)
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
