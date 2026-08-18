# Notide

English | [中文](docs/DEADME_ZH.md)

Notide is a lightweight Vue 3 Markdown notebook with a calm, paper-like workspace. The browser UI and native Windows/Android shells share one codebase, with offline-first editing, the Notide syntax profile, and optional Cloudflare R2 sync.

## Run locally

```bash
npm install
npm run dev
```

## Cloudflare sync

The optional Worker in `workers/index.js` stores note JSON in Cloudflare R2. `wrangler.toml` names the service `notide-sync` and binds `NOTES_BUCKET` to the `notide-notes` bucket. The client remains fully usable offline when no endpoint is configured.

### Deploy from the Cloudflare Dashboard with GitHub

This route needs only a browser. Cloudflare Workers Builds deploys the Worker again whenever the production branch changes:

1. In **R2 Object Storage**, create the `notide-notes` bucket. Create it before the first deployment because `wrangler.toml` refers to this exact name.
2. In **Workers & Pages**, choose **Create** and **Import a repository**. Authorize GitHub, select this repository, and use `main` as the production branch.
3. Leave the root directory at the repository root (the blank/default value), leave the build command empty, and use `npx wrangler deploy` as the deploy command. The deploy reads `wrangler.toml` and creates the `NOTES_BUCKET` binding, so do not add a second R2 binding by hand.
4. Start the first deployment. When it succeeds, open the Worker and copy its `workers.dev` URL.
5. Open **Settings** > **Variables & Secrets**, add `SYNC_TOKEN` as an encrypted runtime secret, and deploy the resulting version. Do not put it under **Settings** > **Build**: build secrets are not available to requests handled by the running Worker.

The API is unprotected between the first deployment and adding `SYNC_TOKEN`; do not connect Notide or upload notes during that interval. If the dashboard offers build watch paths, limiting them to `workers/**`, `wrangler.toml`, `package.json`, and `package-lock.json` avoids redeploying the Worker for unrelated UI-only commits.

Dashboard settings do not write changes back to GitHub. For this repository, use the following ownership model:

- Git is the source of truth for Worker code, service name, compatibility date, routes, and R2 bindings. A later Git deployment replaces Dashboard code-editor changes, plain runtime variables, and binding changes with the values in `wrangler.toml`. Replacing a binding does not delete objects in either R2 bucket.
- The Cloudflare Dashboard is the source of truth for the encrypted runtime `SYNC_TOKEN` and Workers Builds settings. Wrangler preserves encrypted secrets across normal deployments unless a secret is explicitly deleted. Plain Dashboard variables are different and may be overwritten unless `keep_vars = true` is deliberately configured.
- Neither runtime variables, secrets, bindings, nor automatically provisioned resource IDs are silently committed to GitHub. Cloudflare can propose a configuration pull request only when a repository has no Wrangler config; Notide already has one.

Do not edit a Git-connected production Worker in the Dashboard code editor as a second deployment workflow. Use either Git deployments or a fully manual Dashboard deployment, not both, or the next push will replace the manual code and binding configuration.

### Deploy with Wrangler

This alternative requires Node.js 20 or newer and a local checkout. Authenticate Wrangler and confirm the account it will use:

```bash
npx wrangler login
npx wrangler whoami
```

Create the R2 bucket once, then deploy the Worker from the repository root:

```bash
npx wrangler r2 bucket create notide-notes
npx wrangler deploy
```

Wrangler prints the service URL, normally `https://notide-sync.<your-subdomain>.workers.dev`. Keep that base URL; Notide appends its API paths itself.

Protect the service with a long, random bearer token. The first deploy creates the Worker so the secret can be attached without storing it in `wrangler.toml` or Git:

```bash
npx wrangler secret put SYNC_TOKEN
```

Enter the token only at Wrangler's prompt. If `SYNC_TOKEN` is omitted, the API is public and anyone who knows the URL can read, change, or delete notes. The Worker intentionally allows cross-origin requests, so a secret is strongly recommended for every Internet-facing deployment.

Verify both authentication and the R2 binding. A protected deployment should return `401` without the header, report `storage: "ready"` from the authenticated health check, and return an empty collection for a new bucket:

```bash
curl -i https://notide-sync.<your-subdomain>.workers.dev/api/health
curl -H "Authorization: Bearer YOUR_SYNC_TOKEN" https://notide-sync.<your-subdomain>.workers.dev/api/health
curl -H "Authorization: Bearer YOUR_SYNC_TOKEN" https://notide-sync.<your-subdomain>.workers.dev/api/notes
```

The health response should resemble `{"ok":true,"service":"notide-sync","version":1,"storage":"ready"}` and the final response should resemble `{"notes":[],"deleted":[],"truncated":false,"cursor":null}`. A `401` means the token is missing or incorrect; `503 storage_unavailable` means the R2 binding or bucket is unavailable. A browser network/CORS error usually points to an incorrect URL, HTTPS problem, or a request that never reached the Worker. Use `npx wrangler tail notide-sync` while reproducing unexpected server errors.

### Connect Notide

For an existing installation, open Settings, enter the Worker base URL and the same token, then use **Test connection** before enabling sync. Do not append `/api/notes`; if it is pasted accidentally, Notide normalizes it back to the base URL. For a preconfigured local or native build, copy `.env.example` to the ignored `.env` file and fill in:

```dotenv
VITE_SYNC_ENDPOINT=https://notide-sync.<your-subdomain>.workers.dev
VITE_SYNC_TOKEN=YOUR_SYNC_TOKEN
```

`VITE_*` values are embedded in the built application. Do not publish a public web bundle containing a private sync token; configure the token in Notide Settings instead. The client stores that setting on the device, pulls remote notes, uploads local edits, merges by `updatedAt`, and preserves delete tombstones. Existing Sail Markdown local data is migrated to the `notide-*` keys on first launch.

To use another bucket or Worker name, update `bucket_name` or `name` in `wrangler.toml` before deployment. Keep the binding name `NOTES_BUCKET` unless the Worker code is updated to match.

### R2 migration

`tools/migrate-r2-notes.ps1` copies objects from the old `sail-markdown-notes` bucket into `notide-notes` without deleting the source. In Cloudflare, create an R2 API token with object read/write access to both buckets and note its Access Key ID, Secret Access Key, and account ID. Install AWS CLI v2, set the credentials for the current PowerShell session, and review the dry run before applying:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = 'YOUR_ACCOUNT_ID'
$env:AWS_ACCESS_KEY_ID = 'YOUR_R2_ACCESS_KEY_ID'
$env:AWS_SECRET_ACCESS_KEY = 'YOUR_R2_SECRET_ACCESS_KEY'
$env:AWS_DEFAULT_REGION = 'auto'

.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID -DryRun
.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID
```

Remove the credential environment variables after migration. The API remains `/api/notes`; revisions, tombstones, pagination, and note fields remain compatible.

## Native clients

The `src-tauri` project is a Tauri 2 shell for Windows and Android. The same Vue bundle runs inside the native WebView, while local drafts work offline.

```bash
npx tauri icon public/notide-icon.svg
npm run native:android:init
npm run native:dev
npm run native:build
npm run native:android
npm run native:android:release
```

Android builds require the Android SDK/NDK and Rust Android targets. Windows builds require the WebView2 runtime and the Rust MSVC toolchain. The generated Android project lives under `src-tauri/gen/android` and is intentionally not committed. CI creates it reproducibly before building.

`.github/workflows/build.yml` contains web, Windows, and Android jobs. The Windows job uploads `.msi` and `.exe` installers as `notide-windows`. The Android job uploads an installable debug `.apk` as `notide-android`; `native:android:release` is the release APK/AAB entry point when signing credentials are configured.

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
