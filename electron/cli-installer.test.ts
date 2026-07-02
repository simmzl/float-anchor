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
  it('parseWhich trims and nulls empty', () => {
    expect(parseWhich('/usr/local/bin/fa\n')).toBe('/usr/local/bin/fa')
    expect(parseWhich('   ')).toBeNull()
  })
  it('builds install/uninstall commands', () => {
    expect(installArgs('/a b/cli')).toBe('npm install -g "/a b/cli"')
    expect(uninstallCmd()).toBe('npm uninstall -g float-anchor-cli')
  })
})
