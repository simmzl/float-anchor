import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeSyncData } from '../../../electron/sync/summary'
import { buildProgram } from '../main'

let dir: string, file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fa-cli-')); file = join(dir, 'float-anchor.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

async function run(args: string[]) {
  // buildProgram 返回 commander 程序；全局选项(--data/--force)须在子命令名之前
  const program = buildProgram()
  program.exitOverride() // 让错误抛出而非 process.exit
  await program.parseAsync(['node', 'fa', '--data', file, '--force', ...args])
}
const read = () => JSON.parse(readFileSync(file, 'utf-8'))

describe('fa end to end', () => {
  it('creates canvas then adds a card', async () => {
    await run(['canvas', 'create', '突破'])
    expect(read().canvases).toHaveLength(1)
    const cid = read().canvases[0].id
    await run(['card', 'add', '--canvas', cid, '--title', 'A', '--content', '# hi'])
    const card = read().canvases[0].cards[0]
    expect(card).toMatchObject({ title: 'A', content: '# hi', width: 373 })
  })

  it('round-trips through normalizeSyncData unchanged', async () => {
    await run(['canvas', 'create', 'X'])
    const loaded = read()
    expect(normalizeSyncData(loaded)).toEqual(loaded)
  })

  it('rm asks nothing with --yes and cascades card delete', async () => {
    writeFileSync(file, JSON.stringify({
      canvases: [{ id: 'a', name: 'n', cards: [{ id: 'c1', title: '', content: '', x: 0, y: 0, width: 1 }],
        connections: [{ id: 'cn', fromCardId: 'c1', toCardId: 'c1' }], sections: [{ id: 's', name: '', x: 0, y: 0, width: 1, height: 1, color: '#000', cardIds: ['c1'] }] }],
      activeCanvasId: 'a',
    }, null, 2))
    await run(['card', 'rm', 'c1', '--canvas', 'a', '--yes'])
    const c = read().canvases[0]
    expect(c.cards).toEqual([])
    expect(c.connections).toEqual([])
    expect(c.sections[0].cardIds).toEqual([])
  })
})
