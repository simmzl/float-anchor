import type { Command } from 'commander'
import { withData, commit, output, fail, resolveCanvasRef, confirmDelete, GlobalOpts } from './helpers'
import { listConnections, addConnection, removeConnection } from '../core/connection'

export function registerConnect(program: Command) {
  const g = () => program.opts() as GlobalOpts
  const connect = program.command('connect')

  connect.command('ls').requiredOption('--canvas <ref>').action((o: { canvas: string }) => {
    const ctx = withData(g())
    try {
      const rows = listConnections(ctx.data, o.canvas).map((cn) => `${cn.id.slice(0, 8)}  ${cn.fromCardId.slice(0, 8)} -> ${cn.toCardId.slice(0, 8)}`)
      output(g().json, rows.join('\n') || '（无连线）', listConnections(ctx.data, o.canvas))
    } catch (e) { fail(2, (e as Error).message, g().json) }
  })

  connect.command('add').option('--canvas <ref>').requiredOption('--from <cardRef>').requiredOption('--to <cardRef>')
    .action((o: any) => {
      const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
      try {
        const { data, connection } = addConnection(ctx.data, canvasRef, o.from, o.to)
        commit(ctx, data); output(g().json, `✓ 已连接 ${connection.id.slice(0, 8)}`, connection)
      } catch (e) { fail(2, (e as Error).message, g().json) }
    })

  connect.command('rm <connId>').option('--canvas <ref>').action((connId: string, o: any) => {
    const ctx = withData(g()); const canvasRef = resolveCanvasRef(ctx, o.canvas)
    confirmDelete(ctx)
    try {
      const { data, removed } = removeConnection(ctx.data, canvasRef, connId)
      commit(ctx, data); output(g().json, `✓ 已删除连线 ${removed.id.slice(0, 8)}`, removed)
    } catch (e) { fail(2, (e as Error).message, g().json) }
  })
}
