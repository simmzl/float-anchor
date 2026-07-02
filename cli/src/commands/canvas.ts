import type { Command } from 'commander'
import { withData, commit, output, fail, confirmDelete, GlobalOpts } from './helpers'
import { listCanvases, createCanvas, renameCanvas, removeCanvas } from '../core/canvas'
import { RefError } from '../core/refs'

export function registerCanvas(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const canvas = program.command('canvas').description('画布：增删改查')

  canvas.command('ls').description('列出所有画布').action(() => {
    const ctx = withData(g())
    const rows = listCanvases(ctx.data).map((c) => `${c.id.slice(0, 8)}  ${c.name}  (${c.cards.length} 卡片)`)
    output(g().json, rows.join('\n') || '（无画布）', listCanvases(ctx.data))
  })

  canvas.command('create <name>').description('新建画布').action((name: string) => {
    const ctx = withData(g())
    const { data, canvas: created } = createCanvas(ctx.data, name)
    commit(ctx, data)
    output(g().json, `✓ 已新建画布「${created.name}」(${created.id.slice(0, 8)})`, created)
  })

  canvas.command('rename <ref> <newName>').description('重命名画布').action((ref: string, newName: string) => {
    const ctx = withData(g())
    try {
      const { data, canvas: c } = renameCanvas(ctx.data, ref, newName)
      commit(ctx, data); output(g().json, `✓ 已重命名为「${c.name}」`, c)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  canvas.command('rm <ref>').description('删除画布').action((ref: string) => {
    const ctx = withData(g())
    confirmDelete(ctx, '画布')
    try {
      const { data, removed } = removeCanvas(ctx.data, ref)
      commit(ctx, data); output(g().json, `✓ 已删除画布「${removed.name}」`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
