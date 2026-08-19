import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import {
  UPDATE_CHECK_INTERVAL_MS,
  compareVersions,
  createNativeUpdateService,
  parseUpdateManifest,
  sha256Hex,
  shouldCheckForUpdate,
} from '../src/update.js'

const apk = new TextEncoder().encode('signed-notide-apk-fixture')
const apkSha256 = createHash('sha256').update(apk).digest('hex')
const certificateSha256 = 'a'.repeat(64)

function manifest(version = '0.4.1') {
  return {
    version,
    notes: 'Release notes',
    pub_date: '2026-08-18T00:00:00.000Z',
    downloads: {
      android: {
        architecture: 'arm64-v8a',
        versionCode: 40001,
        apk: {
          url: 'https://github.com/kingshot101/Notide/releases/download/v0.4.1/Notide.apk',
          sha256: apkSha256,
          size: apk.byteLength,
        },
        signing: { certificateSha256 },
      },
    },
  }
}

test('semantic version comparison handles releases and prereleases', () => {
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0)
  assert.equal(compareVersions('0.4.1', '0.4.0'), 1)
  assert.equal(compareVersions('0.4.0-beta.2', '0.4.0-beta.10'), -1)
  assert.equal(compareVersions('0.4.0', '0.4.0-rc.1'), 1)
})

test('automatic checks are limited to once every 24 hours', () => {
  const now = Date.UTC(2026, 7, 18)
  assert.equal(shouldCheckForUpdate(null, now), true)
  assert.equal(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL_MS + 1, now), false)
  assert.equal(shouldCheckForUpdate(now - UPDATE_CHECK_INTERVAL_MS, now), true)
})

test('Android update manifest requires HTTPS, SHA-256, architecture, and signing identity', () => {
  const parsed = parseUpdateManifest(manifest())
  assert.equal(parsed.version, '0.4.1')
  assert.equal(parsed.android.apk.sha256, apkSha256)
  assert.equal(parsed.android.certificateSha256, certificateSha256)

  const invalid = manifest()
  invalid.downloads.android.apk.url = 'http://example.com/notide.apk'
  assert.throws(() => parseUpdateManifest(invalid), /must use HTTPS/)
})

test('SHA-256 verification returns a lowercase digest', async () => {
  assert.equal(await sha256Hex(apk, webcrypto), apkSha256)
})

test('scheduled checks are throttled while manual checks bypass the interval', async () => {
  let requests = 0
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const service = createNativeUpdateService({
    now: () => 100_000,
    storage,
    cryptoImplementation: webcrypto,
    loadRuntime: async () => ({ native: true, platform: 'android', architecture: 'aarch64', version: '0.4.0' }),
    fetchFn: async () => {
      requests += 1
      return new Response(JSON.stringify(manifest()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const first = await service.checkForUpdates()
  const throttled = await service.checkForUpdates()
  const manual = await service.checkForUpdates({ force: true })
  assert.equal(first.available, true)
  assert.equal(throttled.status, 'throttled')
  assert.equal(manual.available, true)
  assert.equal(requests, 2)
})

test('concurrent automatic and manual checks share one manifest request', async () => {
  let resolveResponse
  let requests = 0
  const service = createNativeUpdateService({
    storage: null,
    now: () => 200_000,
    loadRuntime: async () => ({ native: true, platform: 'android', architecture: 'aarch64', version: '0.4.0' }),
    fetchFn: async () => {
      requests += 1
      return new Promise((resolve) => { resolveResponse = resolve })
    },
  })
  const automatic = service.checkForUpdates()
  const manual = service.checkForUpdates({ force: true })
  await new Promise((resolve) => setImmediate(resolve))
  resolveResponse(new Response(JSON.stringify(manifest()), { status: 200 }))
  const [automaticResult, manualResult] = await Promise.all([automatic, manual])
  assert.equal(requests, 1)
  assert.equal(automaticResult.version, '0.4.1')
  assert.equal(manualResult.version, '0.4.1')
})

test('a failed check is not recorded as a successful 24 hour check', async () => {
  const values = new Map()
  let requests = 0
  const service = createNativeUpdateService({
    now: () => 300_000,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    loadRuntime: async () => ({ native: true, platform: 'android', architecture: 'aarch64', version: '0.4.0' }),
    fetchFn: async () => {
      requests += 1
      if (requests === 1) return new Response('', { status: 503 })
      return new Response(JSON.stringify(manifest()), { status: 200 })
    },
  })
  await assert.rejects(service.checkForUpdates(), /HTTP 503/)
  assert.equal(values.size, 0)
  const retry = await service.checkForUpdates()
  assert.equal(retry.available, true)
  assert.equal(requests, 2)
})
