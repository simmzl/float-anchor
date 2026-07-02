import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDataFile, loadAppData, saveAppData, AppRunningError } from './appdata'

let dir: string
const file = () => join(dir, 'float-anchor.json')
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fa-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('resolveDataFile', () => {
  it('prefers explicit over env', () => {
    process.env.FA_DATA = '/env/path.json'
    expect(resolveDataFile('/explicit.json')).toBe('/explicit.json')
    delete process.env.FA_DATA
  })
  it('uses FA_DATA when no explicit', () => {
    process.env.FA_DATA = '/env/path.json'
    expect(resolveDataFile()).toBe('/env/path.json')
    delete process.env.FA_DATA
  })
})

describe('loadAppData', () => {
  it('returns empty structure when file missing', () => {
    expect(loadAppData(file())).toEqual({ canvases: [], activeCanvasId: null })
  })
  it('parses existing file', () => {
    writeFileSync(file(), JSON.stringify({ canvases: [{ id: 'a', name: 'X', cards: [] }], activeCanvasId: 'a' }))
    expect(loadAppData(file()).canvases[0].name).toBe('X')
  })
})

describe('saveAppData', () => {
  it('writes 2-space JSON atomically and creates a backup of prior file', () => {
    writeFileSync(file(), JSON.stringify({ canvases: [], activeCanvasId: null }))
    const data = { canvases: [{ id: 'a', name: 'X', cards: [] }], activeCanvasId: 'a' }
    saveAppData(file(), data as any, { isAppRunning: () => false })
    expect(readFileSync(file(), 'utf-8')).toBe(JSON.stringify(data, null, 2))
    const backups = readdirSync(dir).filter((f) => f.startsWith('float-anchor.backup-'))
    expect(backups.length).toBe(1)
    expect(existsSync(join(dir, 'float-anchor.json.tmp'))).toBe(false)
  })
  it('skips backup when no prior file exists', () => {
    saveAppData(file(), { canvases: [], activeCanvasId: null } as any, { isAppRunning: () => false })
    expect(readdirSync(dir).filter((f) => f.includes('backup')).length).toBe(0)
  })
  it('throws AppRunningError when app running and not forced', () => {
    expect(() => saveAppData(file(), { canvases: [], activeCanvasId: null } as any, { isAppRunning: () => true }))
      .toThrow(AppRunningError)
  })
  it('writes when app running but forced', () => {
    saveAppData(file(), { canvases: [], activeCanvasId: null } as any, { isAppRunning: () => true, force: true })
    expect(existsSync(file())).toBe(true)
  })
})
