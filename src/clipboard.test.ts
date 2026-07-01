import { describe, it, expect } from 'vitest'
import { buildClipboard, instantiatePaste } from './clipboard'
import type { Canvas } from './types'

const canvas: Canvas = {
  id: 'cv', name: 'cv',
  cards: [
    { id: 'c1', title: 'A', content: '', x: 0, y: 0, width: 300, sourceId: 'src1' },
    { id: 'c2', title: 'B', content: '', x: 50, y: 50, width: 300 },
    { id: 'c3', title: 'C', content: '', x: 999, y: 999, width: 300 },
  ],
  texts: [{ id: 't1', text: 'hi', x: 10, y: 10, width: 200 }],
  labels: [],
  sections: [{ id: 's1', name: 'S', x: 0, y: 0, width: 400, height: 400, color: '#fff', cardIds: ['c1', 'c2'] }],
  connections: [
    { id: 'cn1', fromCardId: 'c1', toCardId: 'c2' },
    { id: 'cn2', fromCardId: 'c2', toCardId: 'c3' },
  ],
}

describe('buildClipboard', () => {
  it('选分区时带上成员卡片', () => {
    const p = buildClipboard(canvas, { cardIds: [], labelIds: [], sectionIds: ['s1'], textIds: [] })!
    expect(p.cards.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(p.sections.map((s) => s.id)).toEqual(['s1'])
  })
  it('只保留两端都在集合内的连线', () => {
    const p = buildClipboard(canvas, { cardIds: ['c1', 'c2'], labelIds: [], sectionIds: [], textIds: [] })!
    expect(p.connections.map((c) => c.id)).toEqual(['cn1']) // cn2 的 c3 不在集合内
  })
  it('全空选择返回 null', () => {
    expect(buildClipboard(canvas, { cardIds: [], labelIds: [], sectionIds: [], textIds: [] })).toBeNull()
  })
})

describe('instantiatePaste', () => {
  const payload = buildClipboard(canvas, { cardIds: ['c1', 'c2'], labelIds: [], sectionIds: ['s1'], textIds: ['t1'] })!

  it('生成全新 id 且带偏移', () => {
    const r = instantiatePaste(payload, 24, 24)
    expect(r.cards.every((c) => c.id !== 'c1' && c.id !== 'c2')).toBe(true)
    const a = r.cards.find((c) => c.title === 'A')!
    expect({ x: a.x, y: a.y }).toEqual({ x: 24, y: 24 })
  })
  it('丢弃 sourceId', () => {
    const r = instantiatePaste(payload, 24, 24)
    expect(r.cards.every((c) => c.sourceId === undefined)).toBe(true)
  })
  it('分区成员 id 重映射到新卡片', () => {
    const r = instantiatePaste(payload, 24, 24)
    const newIds = new Set(r.cards.map((c) => c.id))
    expect(r.sections[0].cardIds!.every((id) => newIds.has(id))).toBe(true)
  })
  it('连线端点重映射到新卡片', () => {
    const r = instantiatePaste(payload, 24, 24)
    const newIds = new Set(r.cards.map((c) => c.id))
    expect(r.connections.every((cn) => newIds.has(cn.fromCardId) && newIds.has(cn.toCardId))).toBe(true)
  })
  it('ids 汇总返回新 id 集合', () => {
    const r = instantiatePaste(payload, 24, 24)
    expect(r.ids.cardIds).toEqual(r.cards.map((c) => c.id))
    expect(r.ids.textIds).toEqual(r.texts.map((t) => t.id))
    expect(r.ids.sectionIds).toEqual(r.sections.map((s) => s.id))
  })
})
