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

// POSIX 单引号转义：单引号内所有 shell 元字符（$、反引号、"、\）均失去特殊含义，
// 唯一需要处理的是字符串本身包含的单引号——用 '\'' 结束当前引号、插入转义的单引号、再开新引号。
function shQuotePosix(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'` }

export function installArgs(cliDir: string): string {
  // win32 走 cmd /c，Windows 资源路径不带 shell 元字符，且打包目标是 mac，双引号足够；
  // 其余平台（含运行测试的 posix 主机）统一走单引号转义，防止路径中的 $/`/"/\ 破坏或自注入命令。
  return process.platform === 'win32'
    ? `npm install -g "${cliDir}"`
    : `npm install -g ${shQuotePosix(cliDir)}`
}
export function uninstallCmd(): string { return 'npm uninstall -g float-anchor-cli' }

export function bundledSkillFile(cliDir: string): string {
  return join(cliDir, 'skill', 'SKILL.md')
}

export function skillInstallDirs(home: string, env: NodeJS.ProcessEnv): string[] {
  const codexHome = env.CODEX_HOME || join(home, '.codex')
  return [
    join(home, '.claude', 'skills', 'floatanchor-cli'),
    join(codexHome, 'skills', 'floatanchor-cli'),
  ]
}
