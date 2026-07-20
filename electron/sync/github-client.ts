// Client ID 属公开信息，内嵌安全。注册 OAuth App 后回填真实值；开发/测试用环境变量覆盖。
// TODO(用户回填)：github.com/settings/applications/new → Enable Device Flow → 复制 Client ID
export const GITHUB_OAUTH_CLIENT_ID =
  process.env.FLOATANCHOR_GH_CLIENT_ID || 'Ov23liPLACEHOLDER'
