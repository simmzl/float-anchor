import { describe, it, expect } from 'vitest'
import { buildShareUrl, canShare } from './share'
import type { AppSettings } from './types'

describe('buildShareUrl', () => {
  it('拼 /c/<id>，去掉域名尾斜杠', () => {
    expect(buildShareUrl('https://v.app', 'abc')).toBe('https://v.app/c/abc')
    expect(buildShareUrl('https://v.app/', 'abc')).toBe('https://v.app/c/abc')
    expect(buildShareUrl('https://v.app///', 'abc')).toBe('https://v.app/c/abc')
  })
})

describe('canShare', () => {
  const base = (o: Partial<AppSettings>): AppSettings => ({ theme: 'light', ...o })
  it('github + 域名 → true', () => {
    expect(canShare(base({ syncProvider: 'github', github: { repo: 'a/b' }, shareDomain: 'https://v.app' }))).toBe(true)
  })
  it('非 github → false', () => {
    expect(canShare(base({ syncProvider: 'webdav', shareDomain: 'https://v.app' }))).toBe(false)
  })
  it('github 但无域名 → false', () => {
    expect(canShare(base({ syncProvider: 'github', github: { repo: 'a/b' } }))).toBe(false)
  })
})
