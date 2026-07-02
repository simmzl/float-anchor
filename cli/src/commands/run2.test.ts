import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../main'

let dir: string, file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fa-cli2-')); file = join(dir, 'float-anchor.json')
  writeFileSync(file, JSON.stringify({
    canvases: [{ id: 'a', name: 'n', cards: [
      { id: 'c1', title: '', content: '', x: 0, y: 0, width: 1 },
      { id: 'c2', title: '', content: '', x: 0, y: 0, width: 1 },
    ] }],
    activeCanvasId: 'a',
  }, null, 2))
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

async function run(args: string[]) {
  // 全局选项(--data/--force)须在子命令名之前
  const p = buildProgram(); p.exitOverride()
  await p.parseAsync(['node', 'fa', '--data', file, '--force', ...args])
}
const read = () => JSON.parse(readFileSync(file, 'utf-8')).canvases[0]

describe('text/label/section/connect commands', () => {
  it('adds a text', async () => { await run(['text', 'add', '--canvas', 'a', '--text', 'hi']); expect(read().texts).toHaveLength(1) })
  it('adds a label with level', async () => { await run(['label', 'add', '--canvas', 'a', '--level', '3']); expect(read().labels[0].level).toBe(3) })
  it('adds a section with color', async () => { await run(['section', 'add', '--canvas', 'a', '--color', '#123456']); expect(read().sections[0].color).toBe('#123456') })
  it('connects two cards', async () => { await run(['connect', 'add', '--canvas', 'a', '--from', 'c1', '--to', 'c2']); expect(read().connections).toHaveLength(1) })
})
