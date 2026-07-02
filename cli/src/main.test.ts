import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isEntrypoint } from './main'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fa-main-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// Node 加载入口时会 realpath 解析，import.meta.url 是真实路径的 file URL；
// 用 realpathSync 构造期望值以忠实复现（macOS 上 /var、/tmp 本身就是软链）。
const metaUrlOf = (p: string) => pathToFileURL(realpathSync(p)).href

describe('isEntrypoint', () => {
  it('true when argv1 is a symlink to the module (npm global bin: bin/fa -> dist/fa.js)', () => {
    const real = join(dir, 'fa.js'); writeFileSync(real, '// bundle')
    const link = join(dir, 'fa'); symlinkSync(real, link)
    expect(isEntrypoint(link, metaUrlOf(real))).toBe(true)
  })
  it('true when argv1 is the module file directly (node dist/fa.js)', () => {
    const real = join(dir, 'fa.js'); writeFileSync(real, '// bundle')
    expect(isEntrypoint(real, metaUrlOf(real))).toBe(true)
  })
  it('false when argv1 is a different file (imported as a library / under vitest)', () => {
    const real = join(dir, 'fa.js'); writeFileSync(real, '// bundle')
    const other = join(dir, 'runner.js'); writeFileSync(other, '// runner')
    expect(isEntrypoint(other, metaUrlOf(real))).toBe(false)
  })
  it('false when argv1 is undefined or nonexistent', () => {
    const real = join(dir, 'fa.js'); writeFileSync(real, '// bundle')
    expect(isEntrypoint(undefined, metaUrlOf(real))).toBe(false)
    expect(isEntrypoint(join(dir, 'nope'), metaUrlOf(real))).toBe(false)
  })
})
