import { describe, it, expect } from 'vitest'
import { listCanvases, createCanvas, renameCanvas, removeCanvas } from './canvas'
import type { AppData } from '../types'

const base = (): AppData => ({
  canvases: [{ id: 'a', name: '突破', cards: [] }, { id: 'b', name: '测试', cards: [] }],
  activeCanvasId: 'a',
})

describe('canvas core', () => {
  it('lists', () => { expect(listCanvases(base()).map((c) => c.name)).toEqual(['突破', '测试']) })
  it('creates with uuid id and appends', () => {
    const { data, canvas } = createCanvas(base(), '新')
    expect(data.canvases).toHaveLength(3)
    expect(canvas.name).toBe('新')
    expect(canvas.id).toMatch(/[0-9a-f-]{36}/)
    expect(canvas.cards).toEqual([])
  })
  it('renames by ref', () => {
    const { canvas } = renameCanvas(base(), '突破', '突破2')
    expect(canvas.name).toBe('突破2')
  })
  it('removes and reassigns activeCanvasId when removing active', () => {
    const { data } = removeCanvas(base(), 'a')
    expect(data.canvases.map((c) => c.id)).toEqual(['b'])
    expect(data.activeCanvasId).toBe('b')
  })
  it('sets activeCanvasId null when removing last', () => {
    let d = base(); d.canvases = [d.canvases[0]]; d.activeCanvasId = 'a'
    expect(removeCanvas(d, 'a').data.activeCanvasId).toBeNull()
  })
})
