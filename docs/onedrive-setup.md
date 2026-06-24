# OneDrive 应用注册指南

本文档用于维护者在 Azure 门户中注册 FloatAnchor 的 OneDrive 应用。

## 前置条件

- 拥有 Microsoft 账户（个人或工作账户）
- 访问 [Azure 门户](https://portal.azure.com/)

## 注册步骤

### 步骤 1：进入应用注册页面

1. 访问 [Azure 门户](https://portal.azure.com/)
2. 在左侧导航栏中找到 **Entra ID**（或 **Azure Active Directory**）
3. 在 Entra ID 左侧菜单中选择 **应用注册** (App registrations)
4. 点击 **新建注册** (New registration)

### 步骤 2：配置支持的账户类型

在 **新建应用注册** 页面上：

1. **名称**：输入 `FloatAnchor OneDrive Sync`（或其他清晰的应用名称）
2. **支持的账户类型**：选择 **任意组织目录中的账户和个人 Microsoft 账户** (Accounts in any organizational directory and personal Microsoft accounts)
3. **重定向 URI**（可选，稍后填写）
4. 点击 **注册** (Register)

应用创建完成后，记下 **应用程序（客户端）ID**，后续会用到。

### 步骤 3：启用公共客户端流

1. 在应用页面左侧菜单中选择 **身份验证** (Authentication)
2. 向下滚动到 **高级设置** (Advanced settings) 部分
3. 在 **允许公共客户端流** (Allow public client flows) 选项下，切换为 **是** (Yes)
4. 点击 **保存** (Save)

### 步骤 4：配置 API 权限

1. 在应用页面左侧菜单中选择 **API 权限** (API permissions)
2. 点击 **添加权限** (Add a permission)
3. 选择 **Microsoft Graph**
4. 选择 **委托权限** (Delegated permissions)
5. 在搜索框中搜索并勾选以下权限：
   - **Files.ReadWrite.AppFolder** — 允许应用读写其专属文件夹
   - **offline_access** — 允许离线访问（刷新令牌）
   - **User.Read** — 允许读取用户基本信息
6. 点击 **添加权限** (Add permissions)

### 步骤 5：复制 Client ID

1. 在应用页面左侧菜单中选择 **概览** (Overview)
2. 复制 **应用程序（客户端）ID** (Application (client) ID) 字段的值

### 步骤 6：配置 `onedrive-config.ts`

1. 打开项目文件 `electron/sync/onedrive-config.ts`
2. 将步骤 5 复制的 Client ID 填入 `ONEDRIVE_CLIENT_ID` 常量，替换空字符串：

```typescript
export const ONEDRIVE_CLIENT_ID = 'YOUR_CLIENT_ID_HERE'
```

例如：
```typescript
export const ONEDRIVE_CLIENT_ID = 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d'
```

## 完成

注册和配置完成后，FloatAnchor 可以使用设备码流程与 OneDrive 进行同步。
