import type { Command } from 'commander'
import { withData, commit, output, fail, resolveCanvasRef, confirmDelete, num, GlobalOpts } from './helpers'
import { listSections, addSection, setSection, removeSection } from '../core/section'
import { RefError } from '../core/refs'

export function registerSection(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const section = program.command('section').description('分区：增删改查')

  section.command('ls').description('列出分区').requiredOption('--canvas <ref>', '目标画布(id/名字)').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listSections(ctx.data, o.canvas).map((s) => `${s.id.slice(0, 8)}  ${s.name}  ${s.color}`)
      output(g().json, rows.join('\n') || '（无分区）', listSections(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  section.command('add').description('新建分区').option('--canvas <ref>', '目标画布(id/名字)').option('--name <n>', '分区名').option('--color <c>', '颜色(如 #60a5fa)；省略按序轮转').option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)').option('--height <n>', '高度(像素)')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, section: created } = addSection(ctx.data, canvasRef, { name: o.name, color: o.color, x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json), height: num(o.height, '--height', g().json) })
        commit(ctx, data); output(g().json, `✓ 已新建分区 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  section.command('set <ref>').description('修改分区').option('--canvas <ref>', '目标画布(id/名字)').option('--name <n>', '分区名').option('--color <c>', '颜色(如 #60a5fa)；省略按序轮转').option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)').option('--height <n>', '高度(像素)')
    .action((ref: string, o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { name: o.name, color: o.color, x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json), height: num(o.height, '--height', g().json) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, section: s } = setSection(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新分区 ${s.id.slice(0, 8)}`, s)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  section.command('rm <ref>').description('删除分区').option('--canvas <ref>', '目标画布(id/名字)').action((ref: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx, '分区')
    try {
      const { data, removed } = removeSection(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除分区 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
