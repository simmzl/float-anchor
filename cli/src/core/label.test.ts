import { describe, it, expect } from 'vitest'
import { addLabel, setLabel, removeLabel, listLabels } from './label'
import type { AppData } from '../types'

const base = (): AppData => ({ canvases: [{ id: 'a', name: 'n', cards: [], labels: [{ id: 'l1', text: '标题', level: 1, x: 0, y: 0, width: 300 }] }], activeCanvasId: 'a' })

describe('label core', () => {
  it('adds with defaults', () => {
    const { label } = addLabel(base(), 'a', {})
    expect(label).toMatchObject({ text: '标题', level: 1, width: 300 })
  })
  it('adds with explicit level', () => { expect(addLabel(base(), 'a', { level: 3 }).label.level).toBe(3) })
  it('sets and removes', () => {
    expect(setLabel(base(), 'a', 'l1', { text: 'H' }).label.text).toBe('H')
    expect(removeLabel(base(), 'a', 'l1').data.canvases[0].labels).toEqual([])
  })
  it('lists', () => { expect(listLabels(base(), 'a')).toHaveLength(1) })
})
