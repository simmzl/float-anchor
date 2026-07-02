import type { Command } from 'commander'
import { withData, commit, output, fail, readContent, resolveCanvasRef, confirmDelete, GlobalOpts } from './helpers'
import { listCards, addCard, setCard, moveCard, removeCard } from '../core/card'
import { RefError } from '../core/refs'

const num = (v?: string) => v == null ? undefined : Number(v)

export function registerCard(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const card = program.command('card')

  card.command('ls').requiredOption('--canvas <ref>').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listCards(ctx.data, o.canvas).map((c) => `${c.id.slice(0, 8)}  ${c.title}`)
      output(g().json, rows.join('\n') || '（无卡片）', listCards(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  card.command('add')
    .option('--canvas <ref>').option('--title <t>').option('--content <m>')
    .option('--x <n>').option('--y <n>').option('--width <n>').option('--height <n>')
    .action((o: any) => {
      const ctx = withData(g())
      const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, card: created } = addCard(ctx.data, canvasRef, {
          title: o.title, content: readContent(o.content),
          x: num(o.x), y: num(o.y), width: num(o.width), height: num(o.height),
        })
        commit(ctx, data); output(g().json, `✓ 已新建卡片 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  card.command('set <ref>')
    .option('--canvas <ref>').option('--title <t>').option('--content <m>')
    .option('--x <n>').option('--y <n>').option('--width <n>').option('--height <n>')
    .action((ref: string, o: any) => {
      const ctx = withData(g())
      const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { title: o.title, content: readContent(o.content), x: num(o.x), y: num(o.y), width: num(o.width), height: num(o.height) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, card: c } = setCard(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新卡片 ${c.id.slice(0, 8)}`, c)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  card.command('mv <ref>')
    .requiredOption('--x <n>').requiredOption('--y <n>').option('--canvas <ref>')
    .action((ref: string, o: any) => {
      const ctx = withData(g())
      const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, card: c } = moveCard(ctx.data, canvasRef, ref, Number(o.x), Number(o.y))
        commit(ctx, data); output(g().json, `✓ 已移动卡片 ${c.id.slice(0, 8)}`, c)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  card.command('rm <ref>').option('--canvas <ref>').action((ref: string, o: any) => {
    const ctx = withData(g())
    const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeCard(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除卡片 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
