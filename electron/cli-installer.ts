import { join } from 'node:path'

export function resolveCliDir(opts: { isPackaged: boolean; resourcesPath: string; appPath: string }): string {
  return opts.isPackaged ? join(opts.resourcesPath, 'cli') : join(opts.appPath, 'cli')
}

export function buildLoginShellCommand(cmd: string): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'cmd', args: ['/c', cmd] }
  const shell = process.env.SHELL || '/bin/zsh'
  return { file: shell, args: ['-ilc', cmd] }
}

export function parseWhich(stdout: string): string | null {
  // 取最后一条非空行：登录 shell(`-ilc`)会 source .zshrc 等，可能在真实路径前打印 banner，
  // 而 `command -v` / `where` 的结果总在最后。
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

export function installArgs(cliDir: string): string { return `npm install -g "${cliDir}"` }
export function uninstallCmd(): string { return 'npm uninstall -g float-anchor-cli' }
