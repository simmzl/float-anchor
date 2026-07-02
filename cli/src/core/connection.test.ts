import { describe, it, expect } from 'vitest'
import { addConnection, removeConnection, listConnections } from './connection'
import type { AppData } from '../types'

const base = (): AppData => ({
  canvases: [{ id: 'a', name: 'n', cards: [
    { id: 'c1', title: '', content: '', x: 0, y: 0, width: 1 },
    { id: 'c2', title: '', content: '', x: 0, y: 0, width: 1 },
  ], connections: [] }],
  activeCanvasId: 'a',
})

describe('connection core', () => {
  it('adds between two cards', () => {
    const { data, connection } = addConnection(base(), 'a', 'c1', 'c2')
    expect(connection).toMatchObject({ fromCardId: 'c1', toCardId: 'c2' })
    expect(data.canvases[0].connections).toHaveLength(1)
  })
  it('rejects self connection', () => { expect(() => addConnection(base(), 'a', 'c1', 'c1')).toThrow() })
  it('rejects missing endpoint', () => { expect(() => addConnection(base(), 'a', 'c1', 'nope')).toThrow() })
  it('rejects duplicate', () => {
    const { data } = addConnection(base(), 'a', 'c1', 'c2')
    expect(() => addConnection(data, 'a', 'c1', 'c2')).toThrow()
  })
  it('removes by id', () => {
    const { data, connection } = addConnection(base(), 'a', 'c1', 'c2')
    expect(removeConnection(data, 'a', connection.id).data.canvases[0].connections).toEqual([])
  })
  it('lists', () => { expect(listConnections(addConnection(base(), 'a', 'c1', 'c2').data, 'a')).toHaveLength(1) })
})
