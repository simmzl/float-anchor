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
