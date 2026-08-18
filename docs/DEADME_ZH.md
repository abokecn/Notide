# Notide

[English](../README.md) | 中文

Notide 是一款轻量的 Vue 3 Markdown 笔记应用，采用安静、纸张化的工作台界面。浏览器、Windows 与 Android 客户端共享同一套前端，支持离线优先编辑、Notide 语法规范，以及可选的 Cloudflare R2 跨端同步。

## 本地运行

```bash
npm install
npm run dev
```

## Cloudflare 同步

可选的 Worker 位于 `workers/index.js`，笔记 JSON 保存在 Cloudflare R2。`wrangler.toml` 将服务命名为 `notide-sync`，并把 `NOTES_BUCKET` 绑定到 `notide-notes` 存储桶。未配置同步端点时，Notide 仍可完全离线使用。

### 通过 Cloudflare Dashboard 连接 GitHub 部署

这条路径只需要浏览器。Cloudflare Workers Builds 会在生产分支更新后自动重新部署 Worker：

1. 进入 **R2 Object Storage**，创建 `notide-notes` 存储桶。`wrangler.toml` 已引用这个固定名称，因此必须在首次部署前创建。
2. 进入 **Workers & Pages**，选择 **Create** 和 **Import a repository**。授权 GitHub，选择本仓库，并把 `main` 设为生产分支。
3. 根目录保持仓库根目录（留空或使用默认值），构建命令留空，部署命令填写 `npx wrangler deploy`。部署会读取 `wrangler.toml` 并创建 `NOTES_BUCKET` 绑定，不要再手工添加第二个 R2 绑定。
4. 执行首次部署；成功后打开 Worker，复制它的 `workers.dev` 地址。
5. 进入 **Settings** > **Variables & Secrets**，把 `SYNC_TOKEN` 添加为加密的运行时 Secret，并部署由此生成的新版本。不要把它放进 **Settings** > **Build**：构建 Secret 不会出现在 Worker 处理请求时的运行环境中。

首次部署完成到添加 `SYNC_TOKEN` 之间，API 暂时没有保护；这段时间不要连接 Notide 或上传笔记。如果 Dashboard 提供 build watch paths，可限制为 `workers/**`、`wrangler.toml`、`package.json` 和 `package-lock.json`，避免只修改界面时重复发布 Worker。

Dashboard 配置不会反向修改 GitHub。本仓库采用以下配置归属：

- Git 是 Worker 代码、服务名、兼容日期、路由和 R2 绑定的唯一来源。后续 Git 部署会用 `wrangler.toml` 覆盖 Dashboard 代码编辑器中的修改、普通运行时变量和绑定修改。切换绑定不会删除任何 R2 存储桶中的对象。
- Cloudflare Dashboard 是加密运行时 `SYNC_TOKEN` 与 Workers Builds 设置的来源。普通部署会保留加密 Secret，只有显式删除 Secret 才会移除。Dashboard 中的普通变量不同；除非明确配置 `keep_vars = true`，否则它们可能在下次部署时被覆盖。
- 运行时变量、Secret、绑定以及自动创建的资源 ID 都不会被静默提交到 GitHub。只有仓库完全没有 Wrangler 配置时，Cloudflare 才可能提出一个待审核的配置 PR；Notide 已包含该配置。

不要同时把 Git 自动部署和 Dashboard 代码编辑器当作两套生产发布流程。请选择 Git 部署或完全手工的 Dashboard 部署之一，否则下一次推送会替换手工代码和绑定配置。

### 使用 Wrangler 部署

这条替代路径需要 Node.js 20 或更高版本以及本地仓库。在项目根目录登录 Wrangler，确认当前账户：

```bash
npx wrangler login
npx wrangler whoami
```

首次部署时创建 R2 存储桶，然后发布 Worker：

```bash
npx wrangler r2 bucket create notide-notes
npx wrangler deploy
```

Wrangler 会输出服务地址，通常为 `https://notide-sync.<你的子域>.workers.dev`。请保留这个基础地址，Notide 会自动补全 API 路径。

建议为所有公网部署设置足够长的随机令牌。首次部署会先创建 Worker，随后可安全写入 Secret，令牌不会进入 `wrangler.toml` 或 Git：

```bash
npx wrangler secret put SYNC_TOKEN
```

只在 Wrangler 的交互提示中输入令牌。如果不设置 `SYNC_TOKEN`，任何知道服务地址的人都能读取、修改或删除笔记。Worker 为跨端客户端开放了跨域请求，因此公网部署必须依靠令牌保护。

部署后验证鉴权和 R2 绑定。启用令牌时，第一个请求应返回 `401`；带正确令牌的健康检查应返回 `storage: "ready"`，新存储桶的笔记列表应为空：

```bash
curl -i https://notide-sync.<你的子域>.workers.dev/api/health
curl -H "Authorization: Bearer 你的同步令牌" https://notide-sync.<你的子域>.workers.dev/api/health
curl -H "Authorization: Bearer 你的同步令牌" https://notide-sync.<你的子域>.workers.dev/api/notes
```

健康检查响应应类似 `{"ok":true,"service":"notide-sync","version":1,"storage":"ready"}`，最后一个响应应类似 `{"notes":[],"deleted":[],"truncated":false,"cursor":null}`。`401` 表示令牌缺失或错误；`503 storage_unavailable` 表示 R2 绑定或存储桶不可用。浏览器中的网络/CORS 错误通常意味着地址错误、HTTPS 问题，或请求根本没有到达 Worker。遇到其他服务端异常时，可运行 `npx wrangler tail notide-sync` 并同时重现请求。

### 连接 Notide

对于已经安装的客户端，在“设置”中填写 Worker 基础地址和同一个令牌，先执行“测试连接”，再启用同步。不要附加 `/api/notes`；即使误粘贴，Notide 也会把它规范化为基础地址。如需为本地或原生构建预设同步配置，可将 `.env.example` 复制为已被 Git 忽略的 `.env`，然后填写：

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

## Notide 语法规范

Notide 语法规范是面向结构化笔记与技术写作的 CommonMark 扩展集合：

- 常用 Markdown、链接、图片、表格（包括多行和无表头单元格）、任务列表、脚注、定义列表、下标、上标、`==高亮==` 和 `++插入++`。
- KaTeX 行内与块级公式、Mermaid 围栏图表、按语言高亮的代码块、代码标题、行号、起始行元数据、高亮行范围，以及 `md-example` 预览/源码块。
- YAML Front Matter 属性面板与无效 YAML 提示。
- 标题、块、行内文本和代码围栏上的 Pandoc 属性，如 `#id`、`.class`、`key=value`。
- Notide 笔记链接与引用：`[[笔记#标题|别名]]`、`![[笔记]]`、`((block-id))`、行尾 `^block-id` 引用和行内 `#标签`。
- `> [!NOTE]`（含 `+`/`-` 折叠）与 `::: note` Callout、`::: details` 详情块、旧版 `::: tabs`/`@tab` 和新版 `:::{tab-set}`/`:::{tab-item}` 标签页。

预览内容在进入页面前会经过清理，脚本、事件属性、表单和嵌入内容会被阻止。Wiki 链接可跳转到当前笔记库中的目标笔记，任务复选框也会把状态写回 Markdown 源文。

## 鸣谢

Notide 的视觉方向与扩展 Markdown 兼容设计参考了 [Inkstone](https://github.com/shuaiplus/inkstone)。Inkstone 采用 [GNU 宽通用公共许可证 v3.0](https://www.gnu.org/licenses/lgpl-3.0.html) 发布。Notide 为独立实现，与 Inkstone 及其维护者不存在隶属、官方合作、赞助或背书关系。
