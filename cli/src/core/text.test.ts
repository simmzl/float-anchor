import { describe, it, expect } from 'vitest'
import { addText, setText, removeText, listTexts } from './text'
import type { AppData } from '../types'

const base = (): AppData => ({ canvases: [{ id: 'a', name: 'n', cards: [], texts: [{ id: 't1', text: 'x', x: 0, y: 0, width: 300 }] }], activeCanvasId: 'a' })

describe('text core', () => {
  it('adds with default width + layout', () => {
    const { text } = addText(base(), 'a', { text: 'hello' })
    expect(text).toMatchObject({ text: 'hello', width: 300 })
    expect(typeof text.x).toBe('number')
  })
  it('sets and removes', () => {
    expect(setText(base(), 'a', 't1', { text: 'y' }).text.text).toBe('y')
    expect(removeText(base(), 'a', 't1').data.canvases[0].texts).toEqual([])
  })
  it('lists', () => { expect(listTexts(base(), 'a')).toHaveLength(1) })
})
