import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { ONEDRIVE_AUTHORITY, ONEDRIVE_CLIENT_ID, ONEDRIVE_SCOPES, GRAPH_BASE } from './onedrive-config'

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
  expiresIn: number
}

let tokenFilePath = ''
export function initOneDriveAuth(filePath: string) { tokenFilePath = filePath }

let accessToken: string | null = null
let accessTokenExpiry = 0
let cancelled = false

function form(obj: Record<string, string>) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

function saveRefreshToken(rt: string) {
  if (!tokenFilePath) return
  try {
    if (!fs.existsSync(path.dirname(tokenFilePath))) fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true })
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(rt)
      // safeStorage 不可用时（如无 keyring 的 Linux 环境）降级为明文存储，属 Electron 既有模型权衡
      : Buffer.from(rt, 'utf-8')
    fs.writeFileSync(tokenFilePath, enc)
  } catch (err) { console.error('saveRefreshToken failed:', err) }
}

function readRefreshToken(): string | null {
  try {
    if (!tokenFilePath || !fs.existsSync(tokenFilePath)) return null
    const buf = fs.readFileSync(tokenFilePath)
    // safeStorage 不可用时（如无 keyring 的 Linux 环境）降级为明文读取，属 Electron 既有模型权衡
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch { return null }
}

export function isConnected(): boolean {
  return !!readRefreshToken()
}

export function disconnect() {
  accessToken = null
  accessTokenExpiry = 0
  try { if (tokenFilePath && fs.existsSync(tokenFilePath)) fs.unlinkSync(tokenFilePath) } catch {}
}

export function cancelDeviceLogin() { cancelled = true }

async function setTokensFromResponse(json: any) {
  accessToken = json.access_token
  accessTokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 // 提前 60s 过期
  if (json.refresh_token) saveRefreshToken(json.refresh_token)
}

export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiry) return accessToken
  const rt = readRefreshToken()
  if (!rt) throw new Error('OneDrive 未连接')
  const resp = await fetch(`${ONEDRIVE_AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: ONEDRIVE_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: rt,
      scope: ONEDRIVE_SCOPES,
    }),
  })
  const json = await resp.json()
  if (resp.ok && json.access_token) {
    await setTokensFromResponse(json)
    return accessToken!
  }
  // 仅确定的授权失效（HTTP 400 + invalid_grant/invalid_client）时才删除 token
  if (resp.status === 400 && (json.error === 'invalid_grant' || json.error === 'invalid_client')) {
    disconnect()
    throw new Error('OneDrive 登录已失效，请重新连接')
  }
  // 5xx / 429 / 其他非授权错误：不删 token，让下次同步重试
  throw new Error(`OneDrive 刷新令牌失败（${resp.status}），稍后重试`)
}

export async function loadAccount(): Promise<string | undefined> {
  try {
    const token = await getAccessToken()
    const resp = await fetch(`${GRAPH_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (!resp.ok) return undefined
    const me = await resp.json()
    return me.userPrincipalName || me.mail || undefined
  } catch { return undefined }
}

export async function startDeviceLogin(onCode: (info: DeviceCodeInfo) => void): Promise<{ ok: true; account?: string } | { ok: false; error: string }> {
  cancelled = false
  let dcResp: Response
  let dc: any
  try {
    dcResp = await fetch(`${ONEDRIVE_AUTHORITY}/oauth2/v2.0/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: ONEDRIVE_CLIENT_ID, scope: ONEDRIVE_SCOPES }),
    })
    dc = await dcResp.json()
  } catch {
    return { ok: false, error: '网络错误，请检查网络后重试' }
  }
  if (!dcResp.ok || !dc.device_code) {
    return { ok: false, error: dc.error_description || '获取设备码失败' }
  }
  onCode({
    userCode: dc.user_code,
    verificationUri: dc.verification_uri,
    message: dc.message,
    expiresIn: dc.expires_in,
  })

  let interval = (dc.interval ?? 5) * 1000
  const deadline = Date.now() + (dc.expires_in ?? 900) * 1000
  while (Date.now() < deadline) {
    if (cancelled) return { ok: false, error: 'cancelled' }
    await new Promise((r) => setTimeout(r, interval))
    if (cancelled) return { ok: false, error: 'cancelled' }
    let tResp: Response
    let tJson: any
    try {
      tResp = await fetch(`${ONEDRIVE_AUTHORITY}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          client_id: ONEDRIVE_CLIENT_ID,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: dc.device_code,
        }),
      })
      tJson = await tResp.json()
    } catch {
      // 网络瞬时错误，继续轮询直到 deadline
      continue
    }
    if (tResp.ok && tJson.access_token) {
      await setTokensFromResponse(tJson)
      const account = await loadAccount()
      return { ok: true, account }
    }
    if (tJson.error === 'authorization_pending') continue
    if (tJson.error === 'slow_down') { interval += 5000; continue }
    if (tJson.error === 'expired_token') return { ok: false, error: '授权码已过期，请重试' }
    if (tJson.error === 'access_denied') return { ok: false, error: '已取消授权' }
    return { ok: false, error: tJson.error_description || '登录失败' }
  }
  return { ok: false, error: '授权超时，请重试' }
}
