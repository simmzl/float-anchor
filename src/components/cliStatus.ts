export type CliState = { loading: boolean; installed: boolean; path?: string; error?: string; busy?: boolean }

export function cliMessage(state: CliState): string {
  if (state.loading) return '检测中…'
  if (state.error === 'no-node') return '未检测到 Node.js 环境，请先安装 Node（nodejs.org）后重试'
  if (state.error) return `操作失败：${state.error}`
  if (state.installed) return `已安装：${state.path ?? 'fa'}　用法示例：fa canvas ls`
  return '未安装。点击「安装」将 fa 命令注册到全局（需要 Node 环境）'
}
