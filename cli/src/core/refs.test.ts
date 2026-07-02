import { describe, it, expect } from 'vitest'
import { resolveCanvas, resolveCard, RefError } from './refs'
import type { AppData, Canvas } from '../types'

const canvas = (over: Partial<Canvas>): Canvas => ({ id: 'id', name: 'n', cards: [], ...over })
const data = (): AppData => ({
  canvases: [
    canvas({ id: 'aaa111', name: '突破', cards: [{ id: 'card-xyz', title: 'T', content: '', x: 0, y: 0, width: 1 }] }),
    canvas({ id: 'aaa999', name: '其它', cards: [] }),
    canvas({ id: 'bbb222', name: '测试', cards: [] }),
  ],
  activeCanvasId: 'aaa111',
})

describe('resolveCanvas', () => {
  it('resolves by exact id', () => { expect(resolveCanvas(data(), 'aaa111').name).toBe('突破') })
  it('resolves by exact name', () => { expect(resolveCanvas(data(), '测试').id).toBe('bbb222') })
  it('resolves by unique id prefix', () => { expect(resolveCanvas(data(), 'bbb').id).toBe('bbb222') })
  it('throws RefError on ambiguous prefix', () => { expect(() => resolveCanvas(data(), 'aaa')).toThrow(RefError) })
  it('throws when not found', () => { expect(() => resolveCanvas(data(), 'zzz')).toThrow(RefError) })
})

describe('resolveCard', () => {
  it('resolves by id prefix', () => {
    const c = resolveCanvas(data(), 'aaa111')
    expect(resolveCard(c, 'card-').id).toBe('card-xyz')
  })
  it('throws when not found', () => {
    expect(() => resolveCard(resolveCanvas(data(), 'aaa111'), 'nope')).toThrow(RefError)
  })
})
