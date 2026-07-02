import { describe, it, expect } from 'vitest'
import { resolveCliDir, buildLoginShellCommand, parseWhich, installArgs, uninstallCmd } from './cli-installer'

describe('cli-installer', () => {
  it('resolves prod cli dir under resourcesPath', () => {
    expect(resolveCliDir({ isPackaged: true, resourcesPath: '/App/Contents/Resources', appPath: '/x' }))
      .toBe('/App/Contents/Resources/cli')
  })
  it('resolves dev cli dir under repo root (appPath)', () => {
    expect(resolveCliDir({ isPackaged: false, resourcesPath: '/ignored', appPath: '/repo' }))
      .toBe('/repo/cli')
  })
  it('builds a login shell command on posix', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const { file, args } = buildLoginShellCommand('command -v npm')
    expect(args).toContain('-ilc'); expect(args).toContain('command -v npm')
    Object.defineProperty(process, 'platform', { value: orig })
    expect(file.length).toBeGreaterThan(0)
  })
  it('builds a cmd /c command on win32', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const { file, args } = buildLoginShellCommand('where npm')
    Object.defineProperty(process, 'platform', { value: orig })
    expect(file).toBe('cmd')
    expect(args).toEqual(['/c', 'where npm'])
  })
  it('parseWhich trims and nulls empty', () => {
    expect(parseWhich('/usr/local/bin/fa\n')).toBe('/usr/local/bin/fa')
    expect(parseWhich('   ')).toBeNull()
  })
  it('parseWhich returns the last non-empty line (tolerates rc-file banners)', () => {
    expect(parseWhich('welcome to my shell\n/usr/local/bin/npm\n')).toBe('/usr/local/bin/npm')
    expect(parseWhich('\n\n/opt/homebrew/bin/fa\n\n')).toBe('/opt/homebrew/bin/fa')
  })
  it('builds install/uninstall commands', () => {
    expect(installArgs('/a b/cli')).toBe("npm install -g '/a b/cli'")
    expect(uninstallCmd()).toBe('npm uninstall -g float-anchor-cli')
  })
  it('single-quote-escapes a path containing shell metacharacters ($)', () => {
    expect(installArgs('/Users/a$b/cli')).toBe("npm install -g '/Users/a$b/cli'")
  })
  it('single-quote-escapes a path containing an embedded single quote', () => {
    expect(installArgs("/Users/a'b/cli")).toBe(`npm install -g '/Users/a'\\''b/cli'`)
  })
  it('keeps double-quoting on win32', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const result = installArgs('C:\\a b\\cli')
    Object.defineProperty(process, 'platform', { value: orig })
    expect(result).toBe('npm install -g "C:\\a b\\cli"')
  })
})
