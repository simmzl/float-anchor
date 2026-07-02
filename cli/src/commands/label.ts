import type { Command } from 'commander'
import { withData, commit, output, fail, readContent, resolveCanvasRef, confirmDelete, num, level, GlobalOpts } from './helpers'
import { listLabels, addLabel, setLabel, removeLabel } from '../core/label'
import { RefError } from '../core/refs'

export function registerLabel(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const label = program.command('label')

  label.command('ls').requiredOption('--canvas <ref>').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listLabels(ctx.data, o.canvas).map((l) => `${l.id.slice(0, 8)}  H${l.level}  ${l.text}`)
      output(g().json, rows.join('\n') || '（无标签）', listLabels(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  label.command('add').option('--canvas <ref>').option('--text <t>').option('--level <n>').option('--x <n>').option('--y <n>').option('--width <n>')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, label: created } = addLabel(ctx.data, canvasRef, { text: readContent(o.text), level: level(o.level, g().json), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json) })
        commit(ctx, data); output(g().json, `✓ 已新建标签 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  label.command('set <ref>').option('--canvas <ref>').option('--text <t>').option('--level <n>').option('--x <n>').option('--y <n>').option('--width <n>')
    .action((ref: string, o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { text: readContent(o.text), level: level(o.level, g().json), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, label: l } = setLabel(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新标签 ${l.id.slice(0, 8)}`, l)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  label.command('rm <ref>').option('--canvas <ref>').action((ref: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeLabel(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除标签 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
