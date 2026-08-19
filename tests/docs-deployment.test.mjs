import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('project ships the complete GPL-3.0-only license', () => {
  const license = read('LICENSE')
  const project = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))

  assert.equal(project.license, 'GPL-3.0-only')
  assert.equal(lock.packages[''].license, 'GPL-3.0-only')
  assert.match(read('src-tauri/Cargo.toml'), /^license = "GPL-3\.0-only"$/m)
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/)
  assert.match(license, /Version 3, 29 June 2007/)
  assert.match(license, /END OF TERMS AND CONDITIONS/)
  assert.ok(license.length > 30_000)
  assert.match(read('README.md'), /GNU General Public License v3\.0 only/)
  assert.match(read('docs/DEADME_ZH.md'), /GPL-3\.0-only/)
})

test('Cloudflare deployment docs describe automatic provisioning and the v0.4 account contract', () => {
  const english = read('README.md')
  const chinese = read('docs/DEADME_ZH.md')
  const wranglerVersion = JSON.parse(read('package.json')).devDependencies.wrangler
  const required = [
    'SUPER_ADMIN_USERNAME',
    'SUPER_ADMIN_PASSWORD',
    'AUTH_PEPPER',
    'NOTES_BUCKET',
    'migrations/0001_notide_v2.sql',
    'npm run deploy:worker',
    'npx wrangler d1 migrations apply notide --remote',
    'kingshot101/Notide',
    'Access-Control-Allow-Origin: *',
    'ALLOWED_ORIGINS',
  ]

  for (const document of [english, chinese]) {
    for (const value of required) assert.match(document, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(document, /wrangler secret put SYNC_TOKEN/)
    assert.match(document, /SYNC_TOKEN[\s\S]*(?:does not become|不会自动变成)/)
    assert.match(document, /ALLOWED_ORIGINS[\s\S]*(?:does not modify GitHub|不会修改 GitHub)/)
    assert.match(document, /(?:automatic resource provisioning|自动资源预配)/i)
    assert.match(document, new RegExp(wranglerVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(document, /CREATE \.\.\. IF NOT EXISTS/)
    assert.doesNotMatch(document, /REPLACE_WITH_NOTIDE_D1_DATABASE_ID|database_id\s*=/)
    assert.doesNotMatch(document, /wrangler d1 create notide|wrangler r2 bucket create notide-notes/)
  }
})

test('Wrangler uses name-only bindings that can be provisioned without repository IDs', () => {
  const config = read('wrangler.toml')
  const project = JSON.parse(read('package.json'))

  assert.equal(project.devDependencies.wrangler, '4.124.0')
  assert.match(config, /binding = "DB"[\s\S]*database_name = "notide"/)
  assert.match(config, /binding = "NOTES_BUCKET"[\s\S]*bucket_name = "notide-notes"/)
  assert.doesNotMatch(config, /database_id|REPLACE_WITH/)
})

test('environment example exposes only the non-secret Worker endpoint', () => {
  const environment = read('.env.example')
  assert.match(environment, /^VITE_SYNC_ENDPOINT=/m)
  assert.doesNotMatch(environment, /^VITE_SYNC_TOKEN=/m)
  assert.doesNotMatch(environment, /PASSWORD|SESSION_TOKEN/)
})

test('legacy owner migration has an explicit read-only dry run and no default owner', () => {
  const script = read('tools/migrate-notide-worker-v2.ps1')
  assert.match(script, /\[switch\]\$DryRun/)
  assert.match(script, /\[string\]\$OwnerId/)
  assert.match(script, /\[string\]\$OwnerUsername/)
  assert.match(script, /Specify exactly one of OwnerId or OwnerUsername/)
  assert.match(script, /\/api\/admin\/users/)
  assert.match(script, /No migration API was called and no R2 or D1 data was changed/)
  assert.ok(script.indexOf('if ($DryRun)') < script.indexOf('-Method Post'))
  assert.doesNotMatch(script, /\$OwnerId\s*=\s*'super-admin'/)
})

test('release docs require every production signing secret and exclude debug releases', () => {
  const english = read('README.md')
  const chinese = read('docs/DEADME_ZH.md')
  const secrets = [
    'WINDOWS_PFX_BASE64',
    'WINDOWS_PFX_PASSWORD',
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'TAURI_UPDATER_PUBLIC_KEY',
    'ANDROID_KEY_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]

  for (const document of [english, chinese]) {
    for (const secret of secrets) assert.match(document, new RegExp(secret))
    assert.match(document, /https:\/\/github\.com\/kingshot101\/Notide\/releases\/latest\/download\/latest\.json/)
    assert.match(document, /debug[\s\S]*(?:never attached|绝不会附加)/i)
    assert.match(document, /\.exe\.sig/)
    assert.match(document, /npm run signing:generate/)
    assert.match(document, /npm run signing:copy -- TAURI_SIGNING_PRIVATE_KEY/)
    assert.match(document, /npm run signing:copy -- ANDROID_KEY_BASE64/)
    assert.match(document, /Secrets and variables/)
    assert.match(document, /(?:self-signed|自签名)/i)
    assert.doesNotMatch(document, /NSIS updater archive/)
  }
})
