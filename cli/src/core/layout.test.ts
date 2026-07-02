import { describe, it, expect } from 'vitest'
import { nextSlot } from './layout'
import type { Canvas } from '../types'

describe('nextSlot', () => {
  it('places at origin on empty canvas', () => {
    const c: Canvas = { id: 'a', name: 'n', cards: [] }
    expect(nextSlot(c, 373, 200)).toEqual({ x: 40, y: 40 })
  })
  it('places right of existing content without overlap', () => {
    const c: Canvas = { id: 'a', name: 'n', cards: [{ id: 'x', title: '', content: '', x: 40, y: 40, width: 373, height: 200 }] }
    const slot = nextSlot(c, 373, 200)
    expect(slot.x).toBeGreaterThanOrEqual(40 + 373)
    expect(slot.y).toBe(40)
  })
})
