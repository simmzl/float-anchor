// electron-free：仅用全局 fetch，供 vitest 与主进程复用。
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export async function startDeviceFlow(clientId: string, opts?: { scope?: string }): Promise<DeviceCodeResponse> {
  const resp = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: opts?.scope ?? 'repo' }),
  })
  if (!resp.ok) throw new Error(`device_code_http_${resp.status}`)
  const j: any = await resp.json()
  if (j.error) throw new Error(String(j.error))
  return {
    device_code: j.device_code,
    user_code: j.user_code,
    verification_uri: j.verification_uri,
    expires_in: j.expires_in,
    interval: j.interval ?? 5,
  }
}

export async function pollDeviceToken(
  clientId: string,
  deviceCode: string,
  intervalSec: number,
  opts?: { sleep?: (ms: number) => Promise<void>; signal?: { aborted: boolean } },
): Promise<string> {
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let interval = intervalSec
  for (;;) {
    if (opts?.signal?.aborted) throw new Error('aborted')
    await sleep(interval * 1000)
    if (opts?.signal?.aborted) throw new Error('aborted')
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: GRANT_TYPE }),
    })
    const j: any = await resp.json()
    if (j.access_token) return j.access_token as string
    if (j.error === 'authorization_pending') continue
    if (j.error === 'slow_down') { interval += 5; continue }
    throw new Error(String(j.error || 'unknown_error'))
  }
}
