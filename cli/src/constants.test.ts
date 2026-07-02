import { describe, it, expect } from 'vitest'
import { CARD_DEFAULT_WIDTH, SECTION_COLORS } from './constants'

describe('cli constants re-export', () => {
  it('shares App defaults', () => {
    expect(CARD_DEFAULT_WIDTH).toBe(373)
    expect(SECTION_COLORS).toHaveLength(5)
  })
})
