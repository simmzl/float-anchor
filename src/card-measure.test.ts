import { describe, it, expect } from 'vitest'
import { shouldCommitHeight, HEIGHT_COMMIT_TOLERANCE_PX } from './card-measure'

describe('shouldCommitHeight（退出编辑后是否把测得高度写回卡片）', () => {
  it('测量值为空 → 不写', () => {
    expect(shouldCommitHeight(undefined, 150)).toBe(false)
    expect(shouldCommitHeight(null, 150)).toBe(false)
  })

  it('卡片尚无高度（新建卡片首次测量）→ 写', () => {
    expect(shouldCommitHeight(200, undefined)).toBe(true)
    expect(shouldCommitHeight(200, null)).toBe(true)
  })

  it('与现高相等或差 ≤ 2px（亚像素重排）→ 不写', () => {
    expect(shouldCommitHeight(150, 150)).toBe(false)
    expect(shouldCommitHeight(151.5, 150)).toBe(false)
    expect(shouldCommitHeight(150, 152)).toBe(false) // 差恰为 2，等于容差 → 不写
  })

  it('与现高差 > 2px → 写', () => {
    expect(shouldCommitHeight(160, 150)).toBe(true)
    expect(shouldCommitHeight(150, 160)).toBe(true)
  })

  it('容差常量为 2px', () => {
    expect(HEIGHT_COMMIT_TOLERANCE_PX).toBe(2)
  })
})
