import { describe, it, expect } from 'vitest'
import * as D from './model-defaults'

describe('model-defaults', () => {
  it('exposes exact App default values', () => {
    expect(D.CARD_DEFAULT_WIDTH).toBe(373)
    expect(D.CARD_DEFAULT_TITLE).toBe('新卡片')
    expect(D.TEXT_DEFAULT_WIDTH).toBe(300)
    expect(D.LABEL_DEFAULT_WIDTH).toBe(300)
    expect(D.LABEL_DEFAULT_LEVEL).toBe(1)
    expect(D.LABEL_DEFAULT_TEXT).toBe('标题')
    expect(D.SECTION_DEFAULT_WIDTH).toBe(600)
    expect(D.SECTION_DEFAULT_HEIGHT).toBe(400)
    expect(D.SECTION_DEFAULT_NAME).toBe('分区')
    expect(D.SECTION_COLORS).toEqual(['#9ca3af', '#60a5fa', '#34d399', '#fb923c', '#f472b6'])
  })
})
