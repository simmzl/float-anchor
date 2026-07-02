import { describe, it, expect } from 'vitest'
import { addSection, setSection, removeSection, listSections } from './section'
import type { AppData } from '../types'

const base = (): AppData => ({ canvases: [{ id: 'a', name: 'n', cards: [], sections: [] }], activeCanvasId: 'a' })

describe('section core', () => {
  it('adds with defaults and rotates color by existing count', () => {
    let { data, section } = addSection(base(), 'a', {})
    expect(section).toMatchObject({ name: '分区', width: 600, height: 400, color: '#9ca3af', cardIds: [] })
    section = addSection(data, 'a', {}).section
    expect(section.color).toBe('#60a5fa')
  })
  it('honors explicit color', () => { expect(addSection(base(), 'a', { color: '#123456' }).section.color).toBe('#123456') })
  it('sets and removes', () => {
    const s1 = addSection(base(), 'a', {})
    const id = s1.section.id
    expect(setSection(s1.data, 'a', id, { name: 'X' }).section.name).toBe('X')
    expect(removeSection(s1.data, 'a', id).data.canvases[0].sections).toEqual([])
  })
  it('lists', () => { expect(listSections(addSection(base(), 'a', {}).data, 'a')).toHaveLength(1) })
})
