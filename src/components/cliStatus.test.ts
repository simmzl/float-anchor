import { describe, it, expect } from 'vitest'
import { cliMessage } from './cliStatus'

describe('cliMessage', () => {
  it('loading', () => { expect(cliMessage({ loading: true, installed: false })).toBe('检测中…') })
  it('installed shows path', () => {
    expect(cliMessage({ loading: false, installed: true, path: '/usr/local/bin/fa' })).toContain('/usr/local/bin/fa')
  })
  it('not installed', () => { expect(cliMessage({ loading: false, installed: false })).toContain('未安装') })
  it('no-node error maps to friendly hint', () => {
    expect(cliMessage({ loading: false, installed: false, error: 'no-node' })).toContain('未检测到 Node')
  })
  it('other error passes through', () => {
    expect(cliMessage({ loading: false, installed: false, error: 'EACCES: permission denied' })).toContain('EACCES')
  })
})
