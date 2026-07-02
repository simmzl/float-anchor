import { describe, it, expect } from 'vitest'
import { addCard, setCard, moveCard, removeCard, listCards } from './card'
import type { AppData } from '../types'

const base = (): AppData => ({
  canvases: [{
    id: 'a', name: '突破',
    cards: [{ id: 'c1', title: 'A', content: '', x: 0, y: 0, width: 373 }],
    connections: [{ id: 'cn1', fromCardId: 'c1', toCardId: 'c1' }],
    sections: [{ id: 's1', name: 'S', x: 0, y: 0, width: 600, height: 400, color: '#000', cardIds: ['c1'] }],
  }],
  activeCanvasId: 'a',
})

describe('card core', () => {
  it('adds with defaults and auto layout', () => {
    const { data, card } = addCard(base(), 'a', {})
    expect(card.title).toBe('新卡片')
    expect(card.width).toBe(373)
    expect(typeof card.x).toBe('number')
    expect(data.canvases[0].cards).toHaveLength(2)
  })
  it('adds with explicit fields (stdin content)', () => {
    const { card } = addCard(base(), 'a', { title: 'T', content: '# hi', x: 10, y: 20, width: 400 })
    expect(card).toMatchObject({ title: 'T', content: '# hi', x: 10, y: 20, width: 400 })
  })
  it('sets patch fields', () => {
    const { card } = setCard(base(), 'a', 'c1', { title: 'A2', width: 500 })
    expect(card).toMatchObject({ title: 'A2', width: 500 })
  })
  it('moves', () => {
    const { card } = moveCard(base(), 'a', 'c1', 99, 88)
    expect(card).toMatchObject({ x: 99, y: 88 })
  })
  it('removes with cascade (connections + section membership)', () => {
    const { data } = removeCard(base(), 'a', 'c1')
    const c = data.canvases[0]
    expect(c.cards).toHaveLength(0)
    expect(c.connections).toEqual([])
    expect(c.sections![0].cardIds).toEqual([])
  })
  it('lists', () => { expect(listCards(base(), 'a').map((c) => c.id)).toEqual(['c1']) })
})
