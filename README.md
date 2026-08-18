# Notide

Notide is a lightweight Vue 3 Markdown notebook inspired by Inkstone's calm, paper-like workspace. The browser UI and native Windows/Android shells share one codebase, with offline-first editing and optional Cloudflare R2 sync.

## Run locally

```bash
npm install
npm run dev
```

## Cloudflare sync

The optional worker in `workers/index.js` stores note JSON in the `notide-notes` R2 bucket. Deploy it with Wrangler, then set `VITE_SYNC_ENDPOINT` or paste the worker URL in Settings. For a private deployment, set the same bearer token on both sides:

```bash
npx wrangler deploy
npx wrangler secret put SYNC_TOKEN
```

The client pulls remote notes, uploads local edits, merges by `updatedAt`, and keeps delete tombstones. It remains fully usable offline and persists notes in `localStorage` when no endpoint is configured. Existing Sail Markdown local data is migrated to the `notide-*` keys on first launch.

### R2 migration

`tools/migrate-r2-notes.ps1` copies objects from the old `sail-markdown-notes` bucket into `notide-notes` without deleting the source. Install AWS CLI v2, set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to an R2 API token that can read and write both buckets, and review the dry run before applying:

```powershell
.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID -DryRun
.\tools\migrate-r2-notes.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID
```

The API remains `/api/notes`; revisions, tombstones, pagination, and note fields remain compatible.

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

## Inkstone syntax profile

Notide follows Inkstone's Markdown profile rather than a reduced CommonMark subset:

- Common Markdown, links, images, tables (including multiline/headerless cells), task lists, footnotes, definition lists, subscript, superscript, `==mark==`, and `++insert++`.
- KaTeX inline `$...$` and block `$$...$$` math, Mermaid fenced diagrams, language-aware code highlighting, code titles, line numbers, start-line metadata, highlighted line ranges, and `md-example` preview/source blocks.
- YAML Front Matter with a properties disclosure and invalid-YAML feedback.
- Pandoc attributes such as `#id`, `.class`, `key=value` on headings, blocks, inline spans (`[text]{.class}`), and code fences.
- Inkstone note syntax: `[[Note#Heading|alias]]`, `![[Note]]`, `((block-id))`, trailing `^block-id` references, and inline `#tags`.
- Callouts in both `> [!NOTE]` (including `+`/`-` folding) and `::: note` forms; details blocks in `::: details` form; legacy `::: tabs`/`@tab` and modern `:::{tab-set}`/`:::{tab-item}` tabs.

The preview sanitizes generated HTML and blocks scripts, event attributes, forms, and embeds before it reaches the DOM. Wiki links resolve to notes in the current notebook, and task checkboxes write their state back to the Markdown source.
