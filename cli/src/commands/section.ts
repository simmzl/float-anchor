import type { Command } from 'commander'
import { withData, commit, output, fail, resolveCanvasRef, confirmDelete, GlobalOpts } from './helpers'
import { listSections, addSection, setSection, removeSection } from '../core/section'
import { RefError } from '../core/refs'

const num = (v?: string) => v == null ? undefined : Number(v)

export function registerSection(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const section = program.command('section')

  section.command('ls').requiredOption('--canvas <ref>').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listSections(ctx.data, o.canvas).map((s) => `${s.id.slice(0, 8)}  ${s.name}  ${s.color}`)
      output(g().json, rows.join('\n') || '（无分区）', listSections(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  section.command('add').option('--canvas <ref>').option('--name <n>').option('--color <c>').option('--x <n>').option('--y <n>').option('--width <n>').option('--height <n>')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, section: created } = addSection(ctx.data, canvasRef, { name: o.name, color: o.color, x: num(o.x), y: num(o.y), width: num(o.width), height: num(o.height) })
        commit(ctx, data); output(g().json, `✓ 已新建分区 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  section.command('set <ref>').option('--canvas <ref>').option('--name <n>').option('--color <c>').option('--x <n>').option('--y <n>').option('--width <n>').option('--height <n>')
    .action((ref: string, o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { name: o.name, color: o.color, x: num(o.x), y: num(o.y), width: num(o.width), height: num(o.height) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, section: s } = setSection(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新分区 ${s.id.slice(0, 8)}`, s)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  section.command('rm <ref>').option('--canvas <ref>').action((ref: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeSection(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除分区 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
