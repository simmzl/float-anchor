import { describe, it, expect } from 'vitest'
import { shouldCommitHeight, shouldGrowToFit, HEIGHT_COMMIT_TOLERANCE_PX } from './card-measure'

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

describe('shouldGrowToFit（图片等异步内容加载后，是否加高卡片以免裁切）', () => {
  it('测量值为空 → 不写', () => {
    expect(shouldGrowToFit(undefined, 150)).toBe(false)
    expect(shouldGrowToFit(null, 150)).toBe(false)
  })

  it('卡片尚无高度 → 写入首个高度', () => {
    expect(shouldGrowToFit(300, undefined)).toBe(true)
    expect(shouldGrowToFit(300, null)).toBe(true)
  })

  it('内容比现高更高（图片加载后撑高）→ 写，避免裁切', () => {
    expect(shouldGrowToFit(600, 200)).toBe(true)
  })

  it('内容比现高矮 → 不写，不抢用户手动拉高的尺寸', () => {
    expect(shouldGrowToFit(100, 400)).toBe(false)
  })

  it('只高出 ≤ 2px（亚像素重排）→ 不写', () => {
    expect(shouldGrowToFit(202, 200)).toBe(false)
    expect(shouldGrowToFit(201.5, 200)).toBe(false)
  })

  it('高出 > 2px → 写', () => {
    expect(shouldGrowToFit(203, 200)).toBe(true)
  })

  it('与 shouldCommitHeight 的差别：变矮时前者写、后者不写', () => {
    expect(shouldCommitHeight(100, 400)).toBe(true)
    expect(shouldGrowToFit(100, 400)).toBe(false)
  })
})
