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
  const t = stdout.trim()
  return t.length > 0 ? t.split('\n')[0].trim() : null
}

export function installArgs(cliDir: string): string { return `npm install -g "${cliDir}"` }
export function uninstallCmd(): string { return 'npm uninstall -g float-anchor-cli' }
