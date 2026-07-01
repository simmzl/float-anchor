import { describe, it, expect } from 'vitest'
import { findSharedCanvas, extractImageNames } from './share'
import type { Snapshot, Canvas } from './types'

const snap: Snapshot = {
  canvases: [
    { id: 'a', name: 'A', cards: [], shareId: 'SID1' },
    { id: 'b', name: 'B', cards: [{ id: 'c1', title: '', content: '![x](fa-img://img%20one.png)\n![y](fa-img://two.jpg)', x: 0, y: 0, width: 300 }], shareId: 'SID2' },
    { id: 'c', name: 'C', cards: [] },
  ],
  activeCanvasId: 'a',
}

describe('findSharedCanvas', () => {
  it('按 shareId 命中', () => { expect(findSharedCanvas(snap, 'SID2')?.id).toBe('b') })
  it('未命中返回 null', () => { expect(findSharedCanvas(snap, 'nope')).toBeNull() })
  it('无 shareId 的画布不被匹配', () => { expect(findSharedCanvas(snap, '')).toBeNull() })
})

describe('extractImageNames', () => {
  it('提取 fa-img 引用并解码', () => {
    const canvas = findSharedCanvas(snap, 'SID2') as Canvas
    const names = extractImageNames(canvas)
    expect(names.has('img one.png')).toBe(true) // %20 解码
    expect(names.has('two.jpg')).toBe(true)
    expect(names.size).toBe(2)
  })
  it('无图片引用返回空集', () => {
    expect(extractImageNames({ id: 'x', name: '', cards: [] }).size).toBe(0)
  })
})
