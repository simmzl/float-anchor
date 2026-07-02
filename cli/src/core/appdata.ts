import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, platform } from 'node:os'
import { execFileSync } from 'node:child_process'
import type { AppData } from '../types'

export class AppRunningError extends Error {
  constructor() { super('FloatAnchor 桌面 App 正在运行，改动可能被覆盖') }
}

export function resolveDataFile(explicit?: string): string {
  if (explicit) return explicit
  if (process.env.FA_DATA) return process.env.FA_DATA
  const home = homedir()
  const p = platform()
  if (p === 'darwin') return join(home, 'Library', 'Application Support', 'float-anchor', 'data', 'float-anchor.json')
  if (p === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'float-anchor', 'data', 'float-anchor.json')
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'float-anchor', 'data', 'float-anchor.json')
}

export function loadAppData(file: string): AppData {
  if (!existsSync(file)) return { canvases: [], activeCanvasId: null }
  return JSON.parse(readFileSync(file, 'utf-8')) as AppData
}

export interface SaveOptions { force?: boolean; isAppRunning?: () => boolean }

function timestamp(): string {
  // 2026-07-02T01:15:28.123Z -> 20260702-011528（与 App 备份命名 float-anchor.backup-YYYYMMDD-HHMMSS 一致）
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

export function saveAppData(file: string, data: AppData, opts: SaveOptions = {}): void {
  const running = (opts.isAppRunning ?? defaultIsAppRunning)()
  if (running && !opts.force) throw new AppRunningError()
  if (existsSync(file)) {
    const backup = join(dirname(file), `float-anchor.backup-${timestamp()}.json`)
    copyFileSync(file, backup)
  }
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

export function defaultIsAppRunning(): boolean {
  try {
    if (platform() === 'win32') {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq FloatAnchor.exe'], { encoding: 'utf-8' })
      return /FloatAnchor\.exe/i.test(out)
    }
    const out = execFileSync('pgrep', ['-f', 'FloatAnchor'], { encoding: 'utf-8' })
    return out.trim().length > 0
  } catch { return false }
}
