// 公共客户端（device code flow），无 client secret，内嵌安全。
// 维护者需在 Entra/Azure 门户注册应用后，把 Application(client) ID 填到这里。
// 注册步骤见 docs/onedrive-setup.md。
export const ONEDRIVE_CLIENT_ID = '' // TODO(maintainer): 填入 Azure 应用的 client id

export const ONEDRIVE_AUTHORITY = 'https://login.microsoftonline.com/common'
export const ONEDRIVE_SCOPES = 'Files.ReadWrite.AppFolder offline_access User.Read'
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export function isOneDriveConfigured(): boolean {
  return ONEDRIVE_CLIENT_ID.trim().length > 0
}
