import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { num, level } from './helpers'

// num()/level() 内部走 fail() -> process.exit(code)。真跑 process.exit 会杀掉 vitest 进程，
// 所以这里 mock process.exit 让它抛错，从而可以用 expect(...).toThrow() 断言"校验失败会中止"，
// 而不需要下沉到 command 层触发真实退出。
// 每个 test 都在 beforeEach 里重新 spyOn 并在 afterEach 里 mockRestore：避免两个 describe 各自在
// collection 阶段（describe body 立即执行）就抢着 vi.spyOn(process, 'exit') 导致互相包裹、
// 断言的 spy 实例和实际生效的 process.exit 不是同一个对象。
describe('num()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') }) as unknown as ReturnType<typeof vi.spyOn>
  })
  afterEach(() => { exitSpy.mockRestore() })

  it('returns undefined for missing value', () => {
    expect(num(undefined, '--x', false)).toBeUndefined()
  })
  it('parses a valid numeric string', () => {
    expect(num('12', '--x', false)).toBe(12)
  })
  it('parses negative and decimal numbers', () => {
    expect(num('-3.5', '--x', false)).toBe(-3.5)
  })
  it('rejects non-numeric input and exits(1) instead of storing NaN', () => {
    expect(() => num('abc', '--x', false)).toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
  it('rejects trailing-unit input like "12px"', () => {
    expect(() => num('12px', '--width', false)).toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
  it('rejects non-finite input (Infinity)', () => {
    expect(() => num('Infinity', '--x', false)).toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('level()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') }) as unknown as ReturnType<typeof vi.spyOn>
  })
  afterEach(() => { exitSpy.mockRestore() })

  it('returns undefined for missing value', () => {
    expect(level(undefined, false)).toBeUndefined()
  })
  it('parses a valid level', () => {
    expect(level('3', false)).toBe(3)
  })
  it('accepts boundary values 0 and 4', () => {
    expect(level('0', false)).toBe(0)
    expect(level('4', false)).toBe(4)
  })
  it('rejects out-of-range level (9) and exits(1)', () => {
    expect(() => level('9', false)).toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
  it('rejects negative level', () => {
    expect(() => level('-1', false)).toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
  it('rejects non-integer level', () => {
    expect(() => level('2.5', false)).toThrow('exit')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
