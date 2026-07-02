import type { Command } from 'commander'
import { withData, commit, output, fail, readContent, resolveCanvasRef, confirmDelete, num, GlobalOpts } from './helpers'
import { listCards, addCard, setCard, moveCard, removeCard } from '../core/card'
import { RefError } from '../core/refs'

export function registerCard(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const card = program.command('card').description('卡片：增删改查')

  card.command('ls').description('列出画布内卡片').requiredOption('--canvas <ref>', '目标画布(id/名字/id前缀)').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listCards(ctx.data, o.canvas).map((c) => `${c.id.slice(0, 8)}  ${c.title}`)
      output(g().json, rows.join('\n') || '（无卡片）', listCards(ctx.data, o.canvas))
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })

  card.command('add').description('新建卡片')
    .option('--canvas <ref>', '目标画布(id/名字)').option('--title <t>', '卡片标题').option('--content <m>', '正文(markdown)；传 - 从 stdin 读')
    .option('--x <n>', 'X 坐标(像素)；与 --y 同时省略则自动布局').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)').option('--height <n>', '高度(像素)')
    .action((o: any) => {
      const ctx = withData(g())
      const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, card: created } = addCard(ctx.data, canvasRef, {
          title: o.title, content: readContent(o.content),
          x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json),
          width: num(o.width, '--width', g().json), height: num(o.height, '--height', g().json),
        })
        commit(ctx, data); output(g().json, `✓ 已新建卡片 ${created.id.slice(0, 8)}`, created)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  card.command('set <ref>').description('修改卡片字段')
    .option('--canvas <ref>', '目标画布(id/名字)').option('--title <t>', '卡片标题').option('--content <m>', '正文(markdown)；传 - 从 stdin 读')
    .option('--x <n>', 'X 坐标(像素)').option('--y <n>', 'Y 坐标(像素)').option('--width <n>', '宽度(像素)').option('--height <n>', '高度(像素)')
    .action((ref: string, o: any) => {
      const ctx = withData(g())
      const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const patch: any = { title: o.title, content: readContent(o.content), x: num(o.x, '--x', g().json), y: num(o.y, '--y', g().json), width: num(o.width, '--width', g().json), height: num(o.height, '--height', g().json) }
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k])
        const { data, card: c } = setCard(ctx.data, canvasRef, ref, patch)
        commit(ctx, data); output(g().json, `✓ 已更新卡片 ${c.id.slice(0, 8)}`, c)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  card.command('mv <ref>').description('移动卡片到 --x/--y')
    .requiredOption('--x <n>', 'X 坐标(像素)').requiredOption('--y <n>', 'Y 坐标(像素)').option('--canvas <ref>', '目标画布(id/名字)')
    .action((ref: string, o: any) => {
      const ctx = withData(g())
      const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, card: c } = moveCard(ctx.data, canvasRef, ref, num(o.x, '--x', g().json)!, num(o.y, '--y', g().json)!)
        commit(ctx, data); output(g().json, `✓ 已移动卡片 ${c.id.slice(0, 8)}`, c)
      } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
    })

  card.command('rm <ref>').description('删除卡片(连带清理其连线)').option('--canvas <ref>', '目标画布(id/名字)').action((ref: string, o: any) => {
    const ctx = withData(g())
    const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeCard(ctx.data, canvasRef, ref)
      commit(ctx, data); output(g().json, `✓ 已删除卡片 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { if (e instanceof RefError) fail(2, e.message, g().json); throw e }
  })
}
