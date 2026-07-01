# FloatAnchor 分享播放器部署指南

FloatAnchor 分享播放器（Share Viewer）是一个 Next.js 应用，用于在线预览和渲染共享的 FloatAnchor 画布。本指南将指导你将播放器部署到 Vercel。

## 概述

分享播放器从 GitHub 数据仓库读取分享的画布数据，并在浏览器中以只读模式渲染。部署后，你可以将生成的域名配置到 FloatAnchor 主应用中，从而实现分享功能。

## 部署流程

### 第 1 步：生成 GitHub 只读 PAT

1. 登录 GitHub，进入 **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. 点击 **Generate new token**
3. 填写基本信息：
   - **Token name**：`FloatAnchor-Share-Viewer`（或其他描述性名称）
   - **Expiration**：选择合适的过期时间（建议 90 days）
4. **Repository access**：选择 **Only select repositories**，仅选择 **数据仓库**（存储分享的画布数据）
5. **Permissions → Repository permissions**：
   - 找到 **Contents** 权限
   - 设置为 **Read-only** ✓
   - 其他权限保持默认（不选）
6. 点击 **Generate token**
7. 复制生成的 token，妥善保管（刷新页面后将无法再看到）

### 第 2 步：Fork 仓库并部署到 Vercel

1. **Fork 本仓库**
   - 访问 [float-anchor](https://github.com/your-username/float-anchor)
   - 点击 **Fork** 按钮，创建你的副本

2. **导入到 Vercel**
   - 访问 [vercel.com](https://vercel.com)
   - 登录你的 Vercel 账户
   - 点击 **Add New → Project**
   - 选择你 fork 的 float-anchor 仓库
   - 点击 **Import**

3. **配置项目**
   - **Project Name**：保持默认或自定义名称
   - **Root Directory**：**必须设为 `viewer`** ⚠️（这是最关键的一步）
   - **Framework Preset**：应自动检测为 Next.js，确认无误

4. **添加环境变量**
   
   在 **Environment Variables** 部分，添加以下三个变量：

   | 变量名 | 值 | 说明 |
   |--------|-----|------|
   | `GITHUB_TOKEN` | `github_pat_xxx_readonly_contents` | 第 1 步生成的只读 token |
   | `GITHUB_REPO` | `owner/repo` | 数据仓库，格式为 `GitHub用户名/仓库名` |
   | `GITHUB_BRANCH` | `main` | 默认分支（可选，默认为 `main`） |

   **示例：**
   ```
   GITHUB_TOKEN=github_pat_11XXXXX_abcdef1234567890...
   GITHUB_REPO=simmzl/float-anchor-data
   GITHUB_BRANCH=main
   ```

5. **开始部署**
   - 点击 **Deploy**
   - 等待部署完成（通常需要 2-5 分钟）
   - 部署成功后，你会得到一个类似 `https://float-anchor-viewer.vercel.app` 的域名

### 第 3 步：配置 FloatAnchor 主应用

1. 在 FloatAnchor 主应用中，进入 **设置 → 分享 → 分享域名**
2. 将第 2 步获得的 Vercel 域名填入，例如：`https://float-anchor-viewer.vercel.app`
3. 保存设置

### 第 4 步：分享画布

1. 在 FloatAnchor 主应用中打开某个画布
2. 点击右上角「分享」按钮
3. 浮层中会显示分享链接，例如：`https://float-anchor-viewer.vercel.app/view?id=xxx`
4. 点击「复制链接」，分享给他人
5. 他人可以点击链接在浏览器中预览你的画布

## 本地开发

如果你需要在本地开发或测试播放器，可以按照以下步骤：

### 环境要求
- Node.js 18+
- npm 或 yarn

### 安装依赖

```bash
cd viewer
npm install
```

### 配置环境变量

在 `viewer` 目录下创建 `.env.local` 文件，添加以下内容：

```
GITHUB_TOKEN=your_github_pat_token_here
GITHUB_REPO=owner/repo
GITHUB_BRANCH=main
```

参考 `.env.example` 文件获取格式示例。

### 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000` 查看应用。

### 构建生产版本

```bash
npm run build
npm run start
```

## 安全说明

部署和使用分享播放器时，请注意以下安全事项：

### Token 安全
- **只读权限**：PAT 仅授予数据仓库的 **Contents: Read-only** 权限，无法修改数据
- **服务端使用**：Token 仅在服务端（Vercel 函数）中使用，不会暴露给浏览器前端
- **环境变量保护**：Vercel 不会在构建日志或错误消息中显示环境变量值

### 链接安全
- **链接即凭证**：分享链接本身就是访问凭证，因此应谨慎分享，避免在公开渠道泄露
- **不可猜测 ID**：分享 ID 采用加密随机生成，无法通过枚举猜测其他用户的分享
- **不可重复使用**：即使获得分享链接，也无法访问该用户的其他非共享画布

### 数据隐私
- **仅暴露已分享内容**：播放器仅能访问已显式标记为分享的画布数据，无法读取私密或草稿画布
- **分享控制**：分享画布的所有权者随时可以取消分享，取消后该链接立即失效
- **读权限仅限**：访问者只能查看和渲染画布，无法修改、复制或导出原始数据

## 常见问题

### 部署后访问提示 "Access Denied"

**可能原因：**
- GITHUB_TOKEN 过期或无效
- GITHUB_REPO 格式错误（应为 `owner/repo`）
- Token 权限不足（未授予数据仓库访问权限）

**解决方案：**
1. 重新生成一个有效的 GitHub PAT
2. 确保 Token 仅授予数据仓库的 Contents: Read-only 权限
3. 在 Vercel 项目设置中更新环境变量

### 画布无法加载

**可能原因：**
- 网络连接问题
- GitHub API 速率限制
- 分享 ID 无效或已取消分享

**解决方案：**
1. 检查网络连接
2. 稍后重试（GitHub API 速率限制会自动恢复）
3. 确认分享链接有效

### 如何更新域名

如果需要更改 Vercel 域名或迁移到自定义域名：

1. 在 FloatAnchor 主应用设置中更新 **分享域名**
2. 已生成的旧分享链接将无法使用（因为域名改变）
3. 用户需要重新复制新的分享链接

## 反馈和支持

如有任何问题，请提交 issue 或联系开发团队。
