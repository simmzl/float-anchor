import type { Command } from 'commander'
import { withData, commit, output, fail, readContent, resolveCanvasRef, confirmDelete, GlobalOpts } from './helpers'
import { listTexts, addText, setText, removeText } from '../core/text'
import { RefError } from '../core/refs'

const num = (v?: string) => v == null ? undefined : Number(v)

export function registerText(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const text = program.command('text')

  text.command('ls').requiredOption('--canvas <ref>').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listTexts(ctx.data, o.canvas).map((t) => `${t.id.slice(0, 8)}  ${t.text.slice(0, 30)}`)
      output(g().json, rows.join('\n') || '（无文本框）', listTexts(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  text.command('add').option('--canvas <ref>').option('--text <t>').option('--x <n>').option('--y <n>').option('--width <n>')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, text: created } = addText(ctx.data, canvasRef, { text: readContent(o.text), x: num(o.x), y: num(o.y), width: num(o.width) })
        commit(ctx, data); output(g().json, `✓ 已新建文本框 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  text.command('set <ref>').option('--canvas <ref>').option('--text <t>').option('--x <n>').option('--y <n>').option('--width <n>')
    .action((ref: string, o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { text: readContent(o.text), x: num(o.x), y: num(o.y), width: num(o.width) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, text: t } = setText(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新文本框 ${t.id.slice(0, 8)}`, t)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  text.command('rm <ref>').option('--canvas <ref>').action((ref: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeText(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除文本框 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
