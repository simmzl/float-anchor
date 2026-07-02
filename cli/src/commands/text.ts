import type { Command } from 'commander'
import { withData, commit, output, fail, readContent, resolveCanvasRef, confirmDelete, num, GlobalOpts } from './helpers'
import { listTexts, addText, setText, removeText } from '../core/text'
import { RefError } from '../core/refs'

export function registerText(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const text = program.command('text').description('文本框：增删改查')

  text.command('ls').description('列出文本框').requiredOption('--canvas <ref>', '目标画布(id/名字)').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listTexts(ctx.data, o.canvas).map((t) => `${t.id.slice(0, 8)}  ${t.text.slice(0, 30)}`)
      output(g().json, rows.join('\n') || '（无文本框）', listTexts(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  text.command('add').description('新建文本框').option('--canvas <ref>', '目标画布(id/名字)').option('--text <t>', '文本内容；传 - 从 stdin 读').option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, text: created } = addText(ctx.data, canvasRef, { text: readContent(o.text), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json) })
        commit(ctx, data); output(g().json, `✓ 已新建文本框 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  text.command('set <ref>').description('修改文本框').option('--canvas <ref>', '目标画布(id/名字)').option('--text <t>', '文本内容；传 - 从 stdin 读').option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)')
    .action((ref: string, o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { text: readContent(o.text), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, text: t } = setText(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新文本框 ${t.id.slice(0, 8)}`, t)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  text.command('rm <ref>').description('删除文本框').option('--canvas <ref>', '目标画布(id/名字)').action((ref: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeText(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除文本框 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
