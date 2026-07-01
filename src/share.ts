import type { AppSettings } from './types'
import { getEffectiveProvider } from './store'

export function buildShareUrl(domain: string, shareId: string): string {
  const base = domain.trim().replace(/\/+$/, '')
  return `${base}/c/${shareId}`
}

export function canShare(settings: AppSettings): boolean {
  return getEffectiveProvider(settings) === 'github' && !!settings.shareDomain?.trim()
}
