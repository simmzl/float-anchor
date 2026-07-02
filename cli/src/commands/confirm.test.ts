import { describe, it, expect, vi, afterEach } from 'vitest'
import { confirmDelete, type Ctx } from './helpers'

const ctx = (opts: any): Ctx => ({ file: '/tmp/x.json', data: { canvases: [], activeCanvasId: null }, opts })

// 固定 isTTY 以确定性测试；恢复原值
function withTTY(value: boolean | undefined, fn: () => void) {
  const orig = process.stdin.isTTY
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  try { fn() } finally { Object.defineProperty(process.stdin, 'isTTY', { value: orig, configurable: true }) }
}

afterEach(() => vi.restoreAllMocks())

describe('confirmDelete', () => {
  it('proceeds with --yes (no prompt, no exit) even in non-TTY', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => { throw new Error('exit') }))
    withTTY(false, () => {
      expect(() => confirmDelete(ctx({ yes: true }), '画布')).not.toThrow()
    })
    expect(exit).not.toHaveBeenCalled()
  })

  it('refuses with exit 1 in non-TTY without --yes (agent/脚本/管道)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => { throw new Error('exit') }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    withTTY(false, () => {
      expect(() => confirmDelete(ctx({}), '卡片')).toThrow('exit')
    })
    expect(exit).toHaveBeenCalledWith(1)
  })
})
