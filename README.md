# Notide

English | [中文](docs/DEADME_ZH.md)

Notide is a lightweight Vue 3 Markdown notebook for the browser, Windows, and Android. It combines offline-first editing, the Notide syntax profile, account-scoped Cloudflare sync, and native Tauri 2 installers.

## Run locally

Node.js 24 or newer is required. GitHub Actions also run on the Node 24 generation of the official actions.

```bash
npm ci
npm run dev
```

## Local Markdown files

Use the file button beside **New note**, or press `Ctrl/Cmd+O`, to open one or more `.md`, `.markdown`, `.mdown`, or `.mkd` files. Notide preserves the source text, adds each file to the current workspace, and applies that workspace's existing offline and sync behavior. Each file may be up to 1 MiB. Use the download button in the editor header to export the current note as Markdown; Android opens the system share sheet when available.

## Cloudflare sync

Notide v0.4 uses two Cloudflare storage services:

- D1 stores users, hashed sessions, note indexes, collection versions, audit records, and rate limits.
- R2 stores versioned note JSON. `NOTES_BUCKET` must point to the `notide-notes` bucket.

The Worker fails closed when D1, R2, or any required bootstrap secret is missing. Wrangler provisions the named D1 and R2 resources on the first deployment, and the Worker initializes its idempotent D1 schema on the first configured request. There is no public interval during setup.

### Deploy from the Cloudflare Dashboard with GitHub

#### 1. Let Wrangler provision D1 and R2

You do not need to create D1 or R2 manually, copy a database ID, or change `wrangler.toml`. The repository commits only stable resource names:

```toml
[[d1_databases]]
binding = "DB"
database_name = "notide"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "NOTES_BUCKET"
bucket_name = "notide-notes"
```

On the first deployment, Wrangler finds resources with these names or creates them in your Cloudflare account and connects the bindings. Account-specific IDs remain in Cloudflare and are not written back to GitHub. The first configured API request creates the D1 tables and indexes with `CREATE ... IF NOT EXISTS`, so a separate initial migration command is not required.

Cloudflare currently labels automatic resource provisioning as Beta. The resources are real, remain in your account, and follow normal D1/R2 billing and limits. Enable R2 for the account if Cloudflare asks you to accept its terms. Do not rename `notide` or `notide-notes` after storing data: a new name can provision a new empty resource and does not migrate existing data.

#### 2. Connect the repository

In **Workers & Pages**, choose **Create** > **Import a repository**, authorize GitHub, and use these values:

| Field | Value |
| --- | --- |
| Repository | `kingshot101/Notide` |
| Production branch | `main` |
| Root directory | `/` (repository root) |
| Build command | `npm ci && npm run test:unit` |
| Deploy command | `npm run deploy:worker` |

`wrangler` is pinned to `4.120.0` in `package-lock.json`, so Git deployments use the tested repository version. `migrations/0001_notide_v2.sql` remains available as the canonical manual migration and recovery entry point, while the Worker keeps its matching bootstrap schema under test for zero-touch first deployment.

If Workers Builds offers watch paths, include `workers/**`, `migrations/**`, `wrangler.toml`, `package.json`, and `package-lock.json`.

#### 3. Add runtime secrets

After the first Worker version exists, open **Settings** > **Variables & Secrets** and add all three values as encrypted runtime secrets:

| Secret | Purpose |
| --- | --- |
| `SUPER_ADMIN_USERNAME` | Bootstrap super-admin login name |
| `SUPER_ADMIN_PASSWORD` | Long, unique bootstrap password |
| `AUTH_PEPPER` | Random server-only value used for password and session hashing |

Use the runtime section, not **Build** secrets. Build secrets are not available when the deployed Worker handles requests. Redeploy after saving them. Missing values return `503 service_not_configured` instead of exposing the API.

Back up `AUTH_PEPPER` securely before creating regular accounts. Changing it invalidates active sessions and makes existing D1 user password hashes unverifiable; it is not a routine rotation setting.

#### 4. Verify the deployment

The unauthenticated root URL should identify API version 2:

```bash
curl https://notide-sync.<your-subdomain>.workers.dev/
```

Then open Notide Settings, enter the Worker base URL, sign in with the super-admin credentials, and use **Test connection**. A healthy authenticated response contains:

```json
{"ok":true,"service":"notide-sync","version":2,"storage":"ready","database":"ready"}
```

Common setup errors are:

- `service_not_configured`: a binding or one of the three runtime secrets is missing.
- `database_unavailable`: the bound D1 database could not be reached or its automatic schema initialization failed.
- `storage_unavailable`: D1 or the `NOTES_BUCKET` R2 binding cannot be used.
- `401 unauthorized`: the client has no valid v0.4 login session.

Use `npx wrangler tail notide-sync` from an authenticated local checkout when server logs are needed.

### What Dashboard changes can affect GitHub?

Changing a Dashboard variable, secret, D1 binding, or R2 binding does not edit the GitHub repository. Cloudflare only reads the repository to build and deploy it.

Git remains the source of truth for Worker code and ordinary Wrangler configuration. The next Git deployment can replace Dashboard code-editor changes, plain variables, and binding changes with `wrangler.toml`. Encrypted runtime secrets are retained by normal Wrangler deployments unless explicitly deleted. Binding changes never copy or delete D1/R2 data.

Do not use the Dashboard code editor as a second production workflow for a Git-connected Worker.

### Allowed web origins

With no extra configuration, the Worker returns `Access-Control-Allow-Origin: *` so the hosted web app and native WebViews can use the same API. It does not use cookie authentication; every protected request still needs a bearer session issued by `/api/auth/login`. The wildcard origin does not bypass account authentication.

To restrict browser callers, add the optional plain runtime variable `ALLOWED_ORIGINS` in **Settings** > **Variables & Secrets**. Use a comma- or whitespace-separated list of exact origins without paths or trailing slashes, for example `https://notide.pages.dev,https://notes.example.com`. Native requests without an `Origin` header remain valid. Do not store this value as a Secret because it is not sensitive.

A Dashboard-only ordinary variable does not modify GitHub and may be replaced by a later Git deployment. To keep the restriction under source control, add the same value under `[vars]` in `wrangler.toml`; otherwise verify the Dashboard value after each deployment. Removing `ALLOWED_ORIGINS` restores the wildcard behavior.

### Deploy with Wrangler instead

For a local deployment, authenticate Wrangler and deploy. The same automatic provisioning flow creates or reuses the named resources:

```bash
npm ci
npx wrangler login
npx wrangler whoami
npm run deploy:worker
npx wrangler secret put SUPER_ADMIN_USERNAME
npx wrangler secret put SUPER_ADMIN_PASSWORD
npx wrangler secret put AUTH_PEPPER
```

Enter each value only at Wrangler's prompt. The first request after the secrets are available initializes the D1 schema. Applying `npx wrangler d1 migrations apply notide --remote` remains an optional, idempotent recovery step; it is not required for the first deployment. Keep the binding names `DB` and `NOTES_BUCKET` unless the Worker source is changed to match.

### Connect Notide

Open Settings, enter the Worker base URL without `/api/notes`, and sign in. The super admin can create admin or user accounts from the same panel. Each account has an isolated note namespace; admins can only access another owner's notes through explicit owner selection permitted by the server.

For a preconfigured local or native build, copy `.env.example` to the ignored `.env` file and set only the endpoint:

```dotenv
VITE_SYNC_ENDPOINT=https://notide-sync.<your-subdomain>.workers.dev
```

Credentials and session tokens are entered at runtime. Do not put them in `VITE_*` variables because Vite embeds those values in the public application bundle.

### Upgrade from the shared `SYNC_TOKEN` Worker

`SYNC_TOKEN` and `VITE_SYNC_TOKEN` are not read by the v0.4 Worker or client. An old token does not become a username, password, or login session automatically. Upgrade all clients, configure the three bootstrap secrets, sign in as the super admin, create any required user accounts, and then migrate legacy R2 objects to one explicit owner.

Anonymous local notes remain local until the user chooses whether to import them after signing in.

### Migrate legacy R2 notes to an owner

Migration is intentionally two-stage and never deletes source objects.

If legacy `notes/` objects are still in the old `sail-markdown-notes` bucket, first copy them into the legacy prefix of `notide-notes`. Create an R2 API token with object read access to the source and write access to the destination, install AWS CLI v2, and run the dry run first:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'YOUR_ACCOUNT_ID'
$env:AWS_ACCESS_KEY_ID = 'YOUR_R2_ACCESS_KEY_ID'
$env:AWS_SECRET_ACCESS_KEY = 'YOUR_R2_SECRET_ACCESS_KEY'
$env:AWS_DEFAULT_REGION = 'auto'

.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID -DryRun
.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID
```

Next obtain a super-admin session without placing the password in the script:

```powershell
$workerUrl = 'https://notide-sync.<your-subdomain>.workers.dev'
$adminUsername = 'YOUR_SUPER_ADMIN_USERNAME'
$securePassword = Read-Host 'Super-admin password' -AsSecureString
$credential = [pscredential]::new($adminUsername, $securePassword)
$loginBody = @{ username = $adminUsername; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$workerUrl/api/auth/login" -ContentType 'application/json' -Body $loginBody
$env:NOTIDE_SESSION_TOKEN = $login.token
```

Run the owner migration dry run. It resolves the target account through the authenticated user directory and performs a read-only R2 listing; it does not call the migration endpoint:

```powershell
.\tools\migrate-notide-worker-v2.ps1 `
  -WorkerUrl $workerUrl `
  -OwnerUsername 'TARGET_USERNAME' `
  -AccountId $env:CLOUDFLARE_ACCOUNT_ID `
  -DryRun
```

After checking the target owner and object list, omit `-DryRun` to perform the idempotent migration:

```powershell
.\tools\migrate-notide-worker-v2.ps1 -WorkerUrl $workerUrl -OwnerUsername 'TARGET_USERNAME'
```

`-OwnerId` can be used instead of `-OwnerUsername`; exactly one is required and there is no implicit owner. Existing note IDs in the destination are skipped. Confirm the destination account in Notide before manually archiving or deleting any legacy objects.

Clear temporary credentials when finished:

```powershell
Remove-Item Env:NOTIDE_SESSION_TOKEN, Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
```

## Native clients and releases

The `src-tauri` project packages the Vue app with Tauri 2 for Windows and Android. Local drafts remain usable without Cloudflare.

```bash
npm run native:android:init
npm run native:dev
npm run native:build
npm run native:android
npm run native:android:release
```

Android requires the SDK/NDK and Rust Android target. Windows requires WebView2 and the Rust MSVC toolchain. The generated `src-tauri/gen/android` directory is intentionally not committed.

### CI checks and production artifacts

Pushes to `main` run web, Windows, and Android validation. Android debug builds are validation inputs only: they are not uploaded as downloadable artifacts and are never attached to a GitHub Release.

Only a `v*` tag starts `.github/workflows/release.yml`. The release gate requires all signing values and publishes only signed production assets. Configure these GitHub Actions repository secrets together:

| Platform | Required secrets |
| --- | --- |
| Windows | `WINDOWS_PFX_BASE64`, `WINDOWS_PFX_PASSWORD` |
| Tauri updater | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBLIC_KEY` |
| Android | `ANDROID_KEY_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |

Any missing value fails the release instead of falling back to an unsigned or debug package. The release workflow produces `notide-windows` and `notide-android` artifacts and attaches signed EXE/MSI installers, the signed Tauri v2 NSIS updater (`.exe` and `.exe.sig`), a signed arm64 APK/AAB, and `latest.json` to the GitHub Release.

Keep the signing keys and certificates stable. Android will reject an update signed with a different key, and the Tauri updater rejects Windows packages without a matching updater signature.

### Update checks

The native update service and signed manifest contract are implemented in `src/update.js`. Windows uses the official Tauri updater. Android accepts only the HTTPS arm64 manifest, verifies the APK SHA-256 and 30 MiB limit, then hands it to the system installer, which enforces the installed application's signing identity.

The canonical manifest URL is:

```text
https://github.com/kingshot101/Notide/releases/latest/download/latest.json
```

The native client checks at startup at most once every 24 hours, and Settings provides a forced manual check. When an update is available, Notide shows it in Settings and the editor top bar; Windows installs through the Tauri updater, while Android verifies the APK and opens the system installer. Debug APKs are deliberately excluded from Releases so they can never be selected as updates.

## Notide syntax profile

The Notide syntax profile is a CommonMark-based superset for structured notes and technical writing:

- Common Markdown, links, images, tables (including multiline/headerless cells), task lists, footnotes, definition lists, subscript, superscript, `==mark==`, and `++insert++`.
- KaTeX inline `$...$` and block `$$...$$` math, Mermaid fenced diagrams, language-aware code highlighting, code titles, line numbers, start-line metadata, highlighted line ranges, and `md-example` preview/source blocks.
- YAML Front Matter with a properties disclosure and invalid-YAML feedback.
- Pandoc attributes such as `#id`, `.class`, `key=value` on headings, blocks, inline spans (`[text]{.class}`), and code fences.
- Notide note links and references: `[[Note#Heading|alias]]`, `![[Note]]`, `((block-id))`, trailing `^block-id` references, and inline `#tags`.
- Callouts in both `> [!NOTE]` (including `+`/`-` folding) and `::: note` forms; details blocks in `::: details` form; legacy `::: tabs`/`@tab` and modern `:::{tab-set}`/`:::{tab-item}` tabs.

The preview sanitizes generated HTML and blocks scripts, event attributes, forms, and embeds before it reaches the DOM. Wiki links resolve to notes in the current notebook, and task checkboxes write their state back to the Markdown source.

## Acknowledgements

Notide's visual direction and extended Markdown compatibility were inspired by [Inkstone](https://github.com/shuaiplus/inkstone), which is distributed under the [GNU Lesser General Public License v3.0](https://www.gnu.org/licenses/lgpl-3.0.html). Notide is an independent implementation and is not affiliated with, endorsed by, or sponsored by Inkstone or its maintainers.
