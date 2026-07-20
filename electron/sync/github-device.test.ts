import { describe, it, expect, vi, afterEach } from 'vitest'
import { startDeviceFlow, pollDeviceToken } from './github-device'

function mockFetchSeq(responses: Array<{ status?: number; ok?: boolean; json: any }>) {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]; i++
    const status = r.status ?? 200
    return { status, ok: r.ok ?? (status >= 200 && status < 300), async json() { return r.json } } as any
  }))
}
const noSleep = () => Promise.resolve()
afterEach(() => vi.unstubAllGlobals())

describe('startDeviceFlow', () => {
  it('返回 device/user code 与 interval 默认 5', async () => {
    mockFetchSeq([{ json: { device_code: 'dc1', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900 } }])
    const r = await startDeviceFlow('cid')
    expect(r.user_code).toBe('WDJB-MJHT')
    expect(r.device_code).toBe('dc1')
    expect(r.interval).toBe(5)
  })
})

describe('pollDeviceToken', () => {
  it('pending → slow_down → 成功 返回 access_token', async () => {
    mockFetchSeq([
      { json: { error: 'authorization_pending' } },
      { json: { error: 'slow_down', interval: 10 } },
      { json: { access_token: 'gho_abc', token_type: 'bearer', scope: 'repo' } },
    ])
    const token = await pollDeviceToken('cid', 'dc1', 1, { sleep: noSleep })
    expect(token).toBe('gho_abc')
  })

  it('expired_token → 抛 message=expired_token', async () => {
    mockFetchSeq([{ json: { error: 'expired_token' } }])
    await expect(pollDeviceToken('cid', 'dc1', 1, { sleep: noSleep })).rejects.toThrow('expired_token')
  })

  it('access_denied → 抛 message=access_denied', async () => {
    mockFetchSeq([{ json: { error: 'access_denied' } }])
    await expect(pollDeviceToken('cid', 'dc1', 1, { sleep: noSleep })).rejects.toThrow('access_denied')
  })

  it('signal.aborted → 抛 aborted，不再请求', async () => {
    mockFetchSeq([{ json: { access_token: 'should-not-reach' } }])
    await expect(pollDeviceToken('cid', 'dc1', 1, { sleep: noSleep, signal: { aborted: true } })).rejects.toThrow('aborted')
  })
})
