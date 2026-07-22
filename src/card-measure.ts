/** 高度写回容差（px）：小于等于此值的差异视为亚像素重排，不写回。 */
export const HEIGHT_COMMIT_TOLERANCE_PX = 2

/**
 * 退出编辑 / 内容变更后，测得的自然高度是否值得写回卡片。
 *
 * - 测量失败（measured 为空）→ 不写。
 * - 卡片尚无高度（新建卡片首次测量，current 为空）→ 写入首个高度。
 * - 与现高之差 ≤ 2px（亚像素重排）→ 不写，避免无意义的持久化 / 远端同步。
 * - 差异 > 2px → 写。
 */
export function shouldCommitHeight(
  measured: number | null | undefined,
  current: number | null | undefined,
): boolean {
  if (measured == null) return false
  if (current == null) return true
  return Math.abs(measured - current) > HEIGHT_COMMIT_TOLERANCE_PX
}

/**
 * 图片等异步内容加载完成后，是否需要加高卡片。
 *
 * 与 shouldCommitHeight 的区别：只在内容装不下时加高，从不压缩。
 * 卡片是 overflow:hidden，测量发生在图片加载前会得到偏小的高度，导致图片被裁切且无滚动条；
 * 但反向的"变矮"可能是用户手动拉高留白，异步加载不该把它抢回去。
 */
export function shouldGrowToFit(
  measured: number | null | undefined,
  current: number | null | undefined,
): boolean {
  if (measured == null) return false
  if (current == null) return true
  return measured - current > HEIGHT_COMMIT_TOLERANCE_PX
}
