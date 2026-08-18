# Notide

[English](../README.md) | 中文

Notide 是一款轻量的 Vue 3 Markdown 笔记应用，界面参考 Inkstone 安静、纸张化的工作台风格。浏览器、Windows 与 Android 客户端共享同一套前端，支持离线优先编辑、完整 Inkstone Markdown 语法，以及可选的 Cloudflare R2 跨端同步。

## 本地运行

```bash
npm install
npm run dev
```

## Cloudflare 同步

可选的 Worker 位于 `workers/index.js`，笔记 JSON 保存在 Cloudflare R2。`wrangler.toml` 将服务命名为 `notide-sync`，并把 `NOTES_BUCKET` 绑定到 `notide-notes` 存储桶。未配置同步端点时，Notide 仍可完全离线使用。

### 部署 Worker

准备一个已启用 Workers 和 R2 的 Cloudflare 账户，并安装 Node.js 20 或更高版本。在项目根目录登录 Wrangler，确认当前账户：

```bash
npx wrangler login
npx wrangler whoami
```

首次部署时创建 R2 存储桶，然后发布 Worker：

```bash
npx wrangler r2 bucket create notide-notes
npx wrangler deploy
```

Wrangler 会输出服务地址，通常为 `https://notide-sync.<你的子域>.workers.dev`。请保留这个基础地址，不要附加 `/api/notes`，Notide 会自动补全 API 路径。

建议为所有公网部署设置足够长的随机令牌。首次部署会先创建 Worker，随后可安全写入 Secret，令牌不会进入 `wrangler.toml` 或 Git：

```bash
npx wrangler secret put SYNC_TOKEN
```

只在 Wrangler 的交互提示中输入令牌。如果不设置 `SYNC_TOKEN`，任何知道服务地址的人都能读取、修改或删除笔记。Worker 为跨端客户端开放了跨域请求，因此公网部署必须依靠令牌保护。

部署后验证鉴权和 R2 绑定。启用令牌时，第一个请求应返回 `401`；带正确令牌访问根路径会返回服务信息，新存储桶的笔记列表应为空：

```bash
curl -i https://notide-sync.<你的子域>.workers.dev/api/notes
curl -H "Authorization: Bearer 你的同步令牌" https://notide-sync.<你的子域>.workers.dev/
curl -H "Authorization: Bearer 你的同步令牌" https://notide-sync.<你的子域>.workers.dev/api/notes
```

最后一个响应应类似 `{"notes":[],"deleted":[],"truncated":false,"cursor":null}`。如果部署成功但 API 返回异常，可运行 `npx wrangler tail notide-sync`，同时重现请求以查看服务端日志。

### 连接 Notide

对于已经安装的客户端，在“设置”中填写 Worker 基础地址和同一个令牌，不要附加 `/api/notes`。如需为本地或原生构建预设同步配置，可将 `.env.example` 复制为已被 Git 忽略的 `.env`，然后填写：

```dotenv
VITE_SYNC_ENDPOINT=https://notide-sync.<你的子域>.workers.dev
VITE_SYNC_TOKEN=你的同步令牌
```

`VITE_*` 变量会被写入最终构建产物。不要把包含私有同步令牌的 Web 构建公开发布；公开 Web 版本应在 Notide 设置中由用户自行配置令牌。客户端会在设备上保存设置，拉取远端笔记、上传本地修改、按 `updatedAt` 合并，并保留删除墓碑。旧版 Sail Markdown 本地数据会在首次启动时自动迁移到 `notide-*` 键。

如需更换 Worker 名称或 R2 存储桶，请在部署前修改 `wrangler.toml` 中的 `name` 或 `bucket_name`。除非同步修改 Worker 源码，否则应保留绑定名 `NOTES_BUCKET`。

### R2 数据迁移

`tools/migrate-r2-notes.ps1` 会把旧 `sail-markdown-notes` 存储桶中的对象复制到 `notide-notes`，不会删除源数据。在 Cloudflare 中创建一个对两个存储桶都具有对象读写权限的 R2 API 令牌，并记录 Access Key ID、Secret Access Key 和账户 ID。安装 AWS CLI v2 后，在当前 PowerShell 会话中设置：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '你的账户ID'
$env:AWS_ACCESS_KEY_ID = '你的R2访问密钥ID'
$env:AWS_SECRET_ACCESS_KEY = '你的R2访问密钥'
$env:AWS_DEFAULT_REGION = 'auto'

.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID -DryRun
.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID
```

先检查 `-DryRun` 输出，确认无误后再执行正式迁移。迁移结束后清除当前会话中的凭据环境变量。API 仍使用 `/api/notes`；revision、删除墓碑、分页和笔记字段均保持兼容。

## 原生客户端

`src-tauri` 是 Notide 的 Tauri 2 原生外壳，Windows 和 Android 客户端运行同一份 Vue 前端，并保留离线草稿。

```bash
npx tauri icon public/notide-icon.svg
npm run native:android:init
npm run native:dev
npm run native:build
npm run native:android
npm run native:android:release
```

Android 构建需要 Android SDK/NDK 和 Rust Android target；Windows 构建需要 WebView2 与 Rust MSVC 工具链。生成的 Android 工程位于 `src-tauri/gen/android`，不会提交到 Git，CI 会在每次构建时重新生成。

`.github/workflows/build.yml` 包含 Web、Windows 和 Android 三个任务。Windows 安装包以 `notide-windows` artifact 上传，包含 `.msi` 和 `.exe`；Android 会以 `notide-android` 上传可直接安装的 arm64 debug APK。配置发布签名后，可通过 `native:android:release` 生成 release APK/AAB。

## Inkstone 语法兼容

Notide 兼容 Inkstone 的 Markdown 配置，而不是缩减版 CommonMark：

- 常用 Markdown、链接、图片、表格（包括多行和无表头单元格）、任务列表、脚注、定义列表、下标、上标、`==高亮==` 和 `++插入++`。
- KaTeX 行内与块级公式、Mermaid 围栏图表、按语言高亮的代码块、代码标题、行号、起始行元数据、高亮行范围，以及 `md-example` 预览/源码块。
- YAML Front Matter 属性面板与无效 YAML 提示。
- 标题、块、行内文本和代码围栏上的 Pandoc 属性，如 `#id`、`.class`、`key=value`。
- Inkstone 笔记语法：`[[笔记#标题|别名]]`、`![[笔记]]`、`((block-id))`、行尾 `^block-id` 引用和行内 `#标签`。
- `> [!NOTE]`（含 `+`/`-` 折叠）与 `::: note` Callout、`::: details` 详情块、旧版 `::: tabs`/`@tab` 和新版 `:::{tab-set}`/`:::{tab-item}` 标签页。

预览内容在进入页面前会经过清理，脚本、事件属性、表单和嵌入内容会被阻止。Wiki 链接可跳转到当前笔记库中的目标笔记，任务复选框也会把状态写回 Markdown 源文。
