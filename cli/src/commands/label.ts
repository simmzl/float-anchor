import type { Command } from 'commander'
import { withData, commit, output, fail, readContent, resolveCanvasRef, confirmDelete, num, level, GlobalOpts } from './helpers'
import { listLabels, addLabel, setLabel, removeLabel } from '../core/label'
import { RefError } from '../core/refs'

export function registerLabel(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const label = program.command('label').description('标签(标题)：增删改查')

  label.command('ls').description('列出标签').requiredOption('--canvas <ref>', '目标画布(id/名字)').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listLabels(ctx.data, o.canvas).map((l) => `${l.id.slice(0, 8)}  H${l.level}  ${l.text}`)
      output(g().json, rows.join('\n') || '（无标签）', listLabels(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  label.command('add').description('新建标签').option('--canvas <ref>', '目标画布(id/名字)').option('--text <t>', '标题文本；传 - 从 stdin 读').option('--level <n>', '级别 0..4').option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, label: created } = addLabel(ctx.data, canvasRef, { text: readContent(o.text), level: level(o.level, g().json), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json) })
        commit(ctx, data); output(g().json, `✓ 已新建标签 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  label.command('set <ref>').description('修改标签').option('--canvas <ref>', '目标画布(id/名字)').option('--text <t>', '标题文本；传 - 从 stdin 读').option('--level <n>', '级别 0..4').option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)')
    .action((ref: string, o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { text: readContent(o.text), level: level(o.level, g().json), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, label: l } = setLabel(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新标签 ${l.id.slice(0, 8)}`, l)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  label.command('rm <ref>').description('删除标签').option('--canvas <ref>', '目标画布(id/名字)').action((ref: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx, '标签')
    try {
      const { data, removed } = removeLabel(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除标签 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
