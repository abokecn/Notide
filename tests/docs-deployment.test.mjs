import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('Cloudflare deployment docs describe the v0.4 D1 and account contract in both languages', () => {
  const english = read('README.md')
  const chinese = read('docs/DEADME_ZH.md')
  const required = [
    'SUPER_ADMIN_USERNAME',
    'SUPER_ADMIN_PASSWORD',
    'AUTH_PEPPER',
    'NOTES_BUCKET',
    'migrations/0001_notide_v2.sql',
    'npm run deploy:worker',
    'npx wrangler d1 migrations apply notide --remote',
    'abokecn/Notide',
    'Access-Control-Allow-Origin: *',
    'ALLOWED_ORIGINS',
  ]

  for (const document of [english, chinese]) {
    for (const value of required) assert.match(document, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(document, /wrangler secret put SYNC_TOKEN/)
    assert.match(document, /SYNC_TOKEN[\s\S]*(?:does not become|不会自动变成)/)
    assert.match(document, /ALLOWED_ORIGINS[\s\S]*(?:does not modify GitHub|不会修改 GitHub)/)
  }
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
    assert.match(document, /https:\/\/github\.com\/abokecn\/Notide\/releases\/latest\/download\/latest\.json/)
    assert.match(document, /debug[\s\S]*(?:never attached|绝不会附加)/i)
    assert.match(document, /\.exe\.sig/)
    assert.doesNotMatch(document, /NSIS updater archive/)
  }
})
