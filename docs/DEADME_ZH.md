# Notide

[English](../README.md) | 中文

Notide 是一款面向浏览器、Windows 和 Android 的轻量 Vue 3 Markdown 笔记应用，支持离线优先编辑、Notide 语法规范、按账号隔离的 Cloudflare 同步，以及 Tauri 2 原生安装包。

## 本地运行

需要 Node.js 24 或更高版本。GitHub Actions 同样使用基于 Node 24 的官方 Action 版本。

```bash
npm ci
npm run dev
```

## 本地 Markdown 文件

点击**新建笔记**旁的文件按钮，或按 `Ctrl/Cmd+O`，即可一次打开一个或多个 `.md`、`.markdown`、`.mdown` 或 `.mkd` 文件。Notide 会完整保留源文本，将文件加入当前工作区，并沿用该工作区现有的离线保存和同步规则。单个文件最大 1 MiB。编辑器标题栏的下载按钮可将当前笔记导出为 Markdown；Android 在支持时会打开系统分享面板。

## Cloudflare 同步

Notide v0.4 使用两种 Cloudflare 存储服务：

- D1 保存用户、哈希后的会话、笔记索引、集合版本、审计记录和限流状态。
- R2 保存带版本的笔记 JSON；`NOTES_BUCKET` 必须绑定 `notide-notes` 存储桶。

缺少 D1、R2 或任一启动 Secret 时，Worker 会默认拒绝服务。Wrangler 会在首次部署时预配具名的 D1/R2，Worker 则在第一次已配置请求中幂等初始化 D1 表结构，不会在部署过程中出现暂时公开的 API。

### 通过 Cloudflare Dashboard 连接 GitHub 部署

#### 1. 由 Wrangler 自动预配 D1 与 R2

你不再需要手工创建 D1/R2、复制数据库 ID 或修改 `wrangler.toml`。仓库只提交稳定的资源名称：

```toml
[[d1_databases]]
binding = "DB"
database_name = "notide"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "NOTES_BUCKET"
bucket_name = "notide-notes"
```

首次部署时，Wrangler 会在你的 Cloudflare 账号中查找同名资源；不存在时自动创建，并完成绑定。账号专属 ID 只保留在 Cloudflare，不会回写 GitHub。第一次已配置的 API 请求会通过 `CREATE ... IF NOT EXISTS` 创建 D1 表与索引，因此不再需要首次部署前单独执行迁移命令。

Cloudflare 目前仍将自动资源预配标为 Beta。创建出的 D1/R2 是真实资源，遵循正常计费和配额；如果 Cloudflare 提示启用 R2 或接受条款，需要先完成该账号步骤。已有数据后不要重命名 `notide` 或 `notide-notes`，新名称可能预配一套新的空资源，并不会自动迁移旧数据。

#### 2. 连接 GitHub 仓库

进入 **Workers & Pages**，选择 **Create** > **Import a repository**，授权 GitHub，并填写：

| 字段 | 值 |
| --- | --- |
| 仓库 | `kingshot101/Notide` |
| 生产分支 | `main` |
| 根目录 | `/`（仓库根目录） |
| 构建命令 | `npm ci && npm run test:unit` |
| 部署命令 | `npm run deploy:worker` |

`wrangler` 已在 `package-lock.json` 固定为 `4.124.0`，Git 部署使用经过测试的仓库版本。`migrations/0001_notide_v2.sql` 仍作为规范的手工迁移与恢复入口保留；Worker 中与它一致的启动 schema 也由测试约束，用于实现首次零配置部署。

如果 Workers Builds 提供 watch paths，可加入 `workers/**`、`migrations/**`、`wrangler.toml`、`package.json` 和 `package-lock.json`。

#### 3. 添加运行时 Secrets

第一个 Worker 版本创建后，打开 **Settings** > **Variables & Secrets**，把以下三项全部添加为加密的运行时 Secret：

| Secret | 用途 |
| --- | --- |
| `SUPER_ADMIN_USERNAME` | 启动超级管理员登录名 |
| `SUPER_ADMIN_PASSWORD` | 足够长且唯一的启动密码 |
| `AUTH_PEPPER` | 仅服务端保存，用于密码与会话哈希的随机值 |

应添加到运行时区域，而不是 **Build** Secrets。构建 Secret 不会出现在已部署 Worker 处理请求时的环境中。保存后重新部署；缺少任一项时，Worker 会返回 `503 service_not_configured`，而不是开放 API。

创建普通账号前，请安全备份 `AUTH_PEPPER`。更换它会使现有会话失效，也会导致 D1 中已有用户的密码哈希无法再验证，因此它不是日常轮换变量。

#### 4. 验证部署

未登录访问根地址时应显示 API 版本 2：

```bash
curl https://notide-sync.<你的子域>.workers.dev/
```

然后在 Notide 设置中填写 Worker 基础地址，使用超级管理员账号登录并执行“测试连接”。健康响应应包含：

```json
{"ok":true,"service":"notide-sync","version":2,"storage":"ready","database":"ready"}
```

常见配置错误：

- `service_not_configured`：缺少绑定或三个运行时 Secret 中的任一项。
- `database_unavailable`：绑定的 D1 无法访问，或自动初始化表结构失败。
- `storage_unavailable`：D1 或 `NOTES_BUCKET` R2 绑定不可用。
- `401 unauthorized`：客户端没有有效的 v0.4 登录会话。

需要服务端日志时，可在已登录 Wrangler 的本地仓库运行 `npx wrangler tail notide-sync`。

### Dashboard 修改会影响 GitHub 吗？

在 Dashboard 修改变量、Secret、D1 绑定或 R2 绑定，不会修改 GitHub 仓库。Cloudflare 只会读取仓库进行构建和部署。

Git 是 Worker 代码和普通 Wrangler 配置的唯一来源。下一次 Git 部署可能用 `wrangler.toml` 覆盖 Dashboard 代码编辑器中的修改、普通变量和绑定修改；加密的运行时 Secret 会被普通 Wrangler 部署保留，除非你明确删除。切换绑定不会复制或删除 D1/R2 数据。

不要把 Dashboard 代码编辑器作为 Git 自动部署之外的第二套生产发布流程。

### 允许的 Web 来源

未额外配置时，Worker 返回 `Access-Control-Allow-Origin: *`，使托管 Web 页面和原生 WebView 能共用同一 API。服务不使用 Cookie 鉴权；每个受保护请求仍必须携带 `/api/auth/login` 签发的 Bearer 会话。允许任意来源并不等于绕过账号认证。

如需限制浏览器来源，可在 **设置** > **变量和 Secret** 中添加普通运行时变量 `ALLOWED_ORIGINS`。值为以逗号或空白分隔的精确 Origin，不含路径和末尾斜杠，例如 `https://notide.pages.dev,https://notes.example.com`。没有 `Origin` 请求头的原生客户端仍可连接。该值不敏感，无需保存为 Secret。

只在 Dashboard 设置普通变量不会修改 GitHub，并且后续 Git 部署可能覆盖它。若要让限制由仓库长期管理，请把同一个值加入 `wrangler.toml` 的 `[vars]`；否则每次部署后检查 Dashboard。删除 `ALLOWED_ORIGINS` 即恢复通配来源。

### 改用 Wrangler 部署

在本地部署时，登录 Wrangler 后直接部署即可；同一套自动预配流程会创建或复用具名资源：

```bash
npm ci
npx wrangler login
npx wrangler whoami
npm run deploy:worker
npx wrangler secret put SUPER_ADMIN_USERNAME
npx wrangler secret put SUPER_ADMIN_PASSWORD
npx wrangler secret put AUTH_PEPPER
```

只在 Wrangler 的交互提示中输入 Secret。Secret 生效后的第一次请求会初始化 D1 schema。`npx wrangler d1 migrations apply notide --remote` 仍可作为可选且幂等的恢复步骤，但首次部署不再需要它。除非同步修改 Worker 源码，否则请保留 `DB` 和 `NOTES_BUCKET` 绑定名。

### 连接 Notide

打开设置，填写不带 `/api/notes` 的 Worker 基础地址并登录。超级管理员可在同一面板创建管理员或普通用户。每个账号有独立的笔记空间；管理员只有在服务端明确允许并选择所有者后，才能管理其他用户的笔记。

如需为本地或原生构建预设地址，把 `.env.example` 复制为被 Git 忽略的 `.env`，只设置端点：

```dotenv
VITE_SYNC_ENDPOINT=https://notide-sync.<你的子域>.workers.dev
```

账号密码和会话令牌均在运行时输入。不要放进 `VITE_*` 变量，因为 Vite 会把它们写入公开的应用构建产物。

### 从共享 `SYNC_TOKEN` Worker 升级

v0.4 Worker 和客户端不再读取 `SYNC_TOKEN` 或 `VITE_SYNC_TOKEN`。旧令牌不会自动变成用户名、密码或登录会话。请先升级所有客户端，配置三个启动 Secret，以超级管理员登录并创建所需用户，再把旧 R2 对象迁移到一个明确指定的所有者。

匿名本地笔记会保持在本地，直到用户登录后明确选择是否导入。

### 把旧 R2 笔记迁移到指定账号

迁移分为两个阶段，所有脚本都不会删除源对象。

如果旧 `notes/` 对象仍在 `sail-markdown-notes` 存储桶，先把它们复制到 `notide-notes` 的旧格式前缀。创建一个对源桶有对象读取权限、对目标桶有对象写入权限的 R2 API Token，安装 AWS CLI v2，并先执行 dry run：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '你的账户ID'
$env:AWS_ACCESS_KEY_ID = '你的R2访问密钥ID'
$env:AWS_SECRET_ACCESS_KEY = '你的R2访问密钥'
$env:AWS_DEFAULT_REGION = 'auto'

.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID -DryRun
.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID
```

随后获取超级管理员会话，密码不需要写入脚本：

```powershell
$workerUrl = 'https://notide-sync.<你的子域>.workers.dev'
$adminUsername = '你的超级管理员用户名'
$securePassword = Read-Host '超级管理员密码' -AsSecureString
$credential = [pscredential]::new($adminUsername, $securePassword)
$loginBody = @{ username = $adminUsername; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$workerUrl/api/auth/login" -ContentType 'application/json' -Body $loginBody
$env:NOTIDE_SESSION_TOKEN = $login.token
```

先运行所有者迁移 dry run。它会通过已鉴权的用户目录解析目标账号，并只读列出 R2 源对象，不会调用迁移接口：

```powershell
.\tools\migrate-notide-worker-v2.ps1 `
  -WorkerUrl $workerUrl `
  -OwnerUsername '目标用户名' `
  -AccountId $env:CLOUDFLARE_ACCOUNT_ID `
  -DryRun
```

确认目标所有者和对象列表后，去掉 `-DryRun` 执行可重复运行的正式迁移：

```powershell
.\tools\migrate-notide-worker-v2.ps1 -WorkerUrl $workerUrl -OwnerUsername '目标用户名'
```

也可用 `-OwnerId` 代替 `-OwnerUsername`；两者必须且只能指定一个，不存在默认所有者。目标空间中已有相同笔记 ID 时会跳过。请先在 Notide 中核对目标账号，再手工归档或删除旧对象。

完成后清除临时凭据：

```powershell
Remove-Item Env:NOTIDE_SESSION_TOKEN, Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
```

## 原生客户端与发布

`src-tauri` 使用 Tauri 2 将 Vue 应用打包为 Windows 与 Android 客户端。未连接 Cloudflare 时，本地草稿仍可使用。

```bash
npm run native:android:init
npm run native:dev
npm run native:build
npm run native:android
npm run native:android:release
```

Android 需要 SDK/NDK 与 Rust Android target；Windows 需要 WebView2 和 Rust MSVC 工具链。生成的 `src-tauri/gen/android` 目录不会提交到 Git。

### CI 检查与正式产物

推送到 `main` 会运行 Web、Windows 和 Android 验证。Android debug 构建只用于验证，不会上传为可下载 artifact，也绝不会附加到 GitHub Release。

只有 `v*` 标签会触发 `.github/workflows/release.yml`。发布门禁要求全部签名值齐全，只发布正式签名产物。请成组配置以下 GitHub Actions 仓库 Secrets：

| 平台 | 必需 Secrets |
| --- | --- |
| Windows | `WINDOWS_PFX_BASE64`、`WINDOWS_PFX_PASSWORD` |
| Tauri 更新器 | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`TAURI_UPDATER_PUBLIC_KEY` |
| Android | `ANDROID_KEY_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |

#### 准备签名 Secrets

请先在仓库之外生成并离线备份签名材料，再前往 **仓库 Settings > Secrets and variables > Actions > New repository secret** 逐项添加。不要使用构建变量，也不要提交编码后的密钥；base64 只是传输编码，不是加密。

1. **Windows：**从可信 CA 获取 Authenticode 代码签名证书，并把私钥导出为带密码的 `.pfx`。自签名证书不适合公开发布，也不能建立终端用户所需的信任。将 PFX 字节转换为 base64 后填入 `WINDOWS_PFX_BASE64`，导出密码填入 `WINDOWS_PFX_PASSWORD`：

   ```powershell
   $pfx = (Resolve-Path 'C:\secure\Notide-code-signing.pfx').Path
   [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx)) | Set-Clipboard
   ```

2. **Tauri 更新器：**生成一组长期使用的 updater 密钥。命令会提示输入密码，并创建 `notide.key` 与 `notide.key.pub`。私钥文件完整内容填入 `TAURI_SIGNING_PRIVATE_KEY`，密码填入 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，公钥文件完整内容填入 `TAURI_UPDATER_PUBLIC_KEY`。请逐条执行 `Set-Clipboard`，每次先粘贴到 GitHub 再复制下一项：

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.notide-signing" | Out-Null
   npx tauri signer generate -w "$env:USERPROFILE\.notide-signing\notide.key"
   Get-Content -Raw "$env:USERPROFILE\.notide-signing\notide.key" | Set-Clipboard
   Get-Content -Raw "$env:USERPROFILE\.notide-signing\notide.key.pub" | Set-Clipboard
   ```

3. **Android：**安装 JDK 17 或更高版本后，创建唯一且长期不变的正式 keystore。离线记录 alias 和密码，再把 keystore 字节转换为 base64 填入 `ANDROID_KEY_BASE64`，其余三个 Android Secrets 填入实际的库密码、alias 和密钥密码。若 PKCS12 只使用同一个密码，请让两个密码 Secret 使用该实际值：

   ```powershell
   keytool -genkeypair -v -keystore 'C:\secure\notide-release.jks' -storetype PKCS12 -alias notide -keyalg RSA -keysize 4096 -validity 10000
   $keystore = (Resolve-Path 'C:\secure\notide-release.jks').Path
   [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) | Set-Clipboard
   ```

请离线备份 PFX、updater 私钥、Android keystore、alias 和全部密码。GitHub 保存 Secret 后不允许再次读取其值；丢失或更换 Android/updater 密钥后，已有安装将无法接受后续更新。

任一值缺失都会使发布失败，不会降级为无签名或 debug 包。发布工作流生成 `notide-windows` 与 `notide-android` artifacts，并向 GitHub Release 附加签名 EXE/MSI、带签名的 Tauri v2 NSIS 更新器（`.exe` 与 `.exe.sig`）、签名 arm64 APK/AAB，以及 `latest.json`。

必须长期保留相同签名密钥与证书。Android 会拒绝由不同密钥签名的升级包，Tauri 更新器也会拒绝与更新公钥不匹配的 Windows 包。

### 更新检查

`src/update.js` 已实现原生更新服务和签名清单契约。Windows 使用官方 Tauri updater；Android 只接受 HTTPS arm64 清单，校验 APK 的 SHA-256 和 30 MiB 上限，再交给系统安装器，由系统检查已安装应用的签名身份。

固定清单地址为：

```text
https://github.com/kingshot101/Notide/releases/latest/download/latest.json
```

原生客户端会在启动时检查更新，但 24 小时内最多自动检查一次；设置中也提供不受该间隔限制的手动检查。发现新版本后，Notide 会在设置和编辑器顶部显示提示；Windows 通过 Tauri updater 安装，Android 校验 APK 后打开系统安装器。debug APK 不会进入 Release，因此不会被更新流程选中。

## Notide 语法规范

Notide 语法规范是面向结构化笔记与技术写作的 CommonMark 扩展集合：

- 常用 Markdown、链接、图片、表格（包括多行和无表头单元格）、任务列表、脚注、定义列表、下标、上标、`==高亮==` 和 `++插入++`。
- KaTeX 行内与块级公式、Mermaid 围栏图表、按语言高亮的代码块、代码标题、行号、起始行元数据、高亮行范围，以及 `md-example` 预览/源码块。
- YAML Front Matter 属性面板与无效 YAML 提示。
- 标题、块、行内文本和代码围栏上的 Pandoc 属性，如 `#id`、`.class`、`key=value`。
- Notide 笔记链接与引用：`[[笔记#标题|别名]]`、`![[笔记]]`、`((block-id))`、行尾 `^block-id` 引用和行内 `#标签`。
- `> [!NOTE]`（含 `+`/`-` 折叠）与 `::: note` Callout、`::: details` 详情块、旧版 `::: tabs`/`@tab` 和新版 `:::{tab-set}`/`:::{tab-item}` 标签页。

预览内容在进入页面前会经过清理，脚本、事件属性、表单和嵌入内容会被阻止。Wiki 链接可跳转到当前笔记库中的目标笔记，任务复选框也会把状态写回 Markdown 源文。

## 开源许可证

Notide 采用 [GNU 通用公共许可证 v3.0（仅此版本）](../LICENSE)（`GPL-3.0-only`）开源。

## 鸣谢

Notide 的视觉方向与扩展 Markdown 兼容设计参考了 [Inkstone](https://github.com/shuaiplus/inkstone)。Inkstone 采用 [GNU 宽通用公共许可证 v3.0](https://www.gnu.org/licenses/lgpl-3.0.html) 发布。Notide 为独立实现，与 Inkstone 及其维护者不存在隶属、官方合作、赞助或背书关系。
