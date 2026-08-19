export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const UPDATE_RETRY_INTERVAL_MS = 15 * 60 * 1000
export const DEFAULT_UPDATE_MANIFEST_URL = 'https://github.com/kingshot101/Notide/releases/latest/download/latest.json'
export const UPDATE_CHECK_STORAGE_KEY = 'notide-update-last-check-v1'
export const MAX_ANDROID_APK_BYTES = 30 * 1024 * 1024

export class UpdateError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'UpdateError'
    this.code = code
  }
}

function parseVersion(version) {
  const match = String(version ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) throw new UpdateError('invalid-version', `Invalid semantic version: ${version}`)
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  }
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return Math.sign(a.numbers[index] - b.numbers[index])
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber)
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

export function shouldCheckForUpdate(lastCheckedAt, now = Date.now(), interval = UPDATE_CHECK_INTERVAL_MS) {
  const last = Number(lastCheckedAt)
  return !Number.isFinite(last) || last <= 0 || now - last >= interval || now < last
}

function assertHttpUrl(value, field) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new UpdateError('invalid-manifest', `${field} must be a valid URL`)
  }
  if (url.protocol !== 'https:') throw new UpdateError('invalid-manifest', `${field} must use HTTPS`)
  return url.href
}

function normalizeSha256(value, field) {
  const digest = String(value ?? '').replaceAll(':', '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new UpdateError('invalid-manifest', `${field} must be a SHA-256 digest`)
  }
  return digest
}

export function parseUpdateManifest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new UpdateError('invalid-manifest', 'The update manifest must be an object')
  }
  parseVersion(payload.version)
  const android = payload.downloads?.android
  if (!android || typeof android !== 'object') {
    throw new UpdateError('invalid-manifest', 'The update manifest does not contain an Android release')
  }
  const apk = android.apk
  if (!apk || typeof apk !== 'object') {
    throw new UpdateError('invalid-manifest', 'The Android release does not contain an APK')
  }
  return {
    version: String(payload.version),
    notes: typeof payload.notes === 'string' ? payload.notes : '',
    publishedAt: typeof payload.pub_date === 'string' ? payload.pub_date : null,
    android: {
      architecture: String(android.architecture ?? ''),
      versionCode: Number(android.versionCode),
      apk: {
        url: assertHttpUrl(apk.url, 'downloads.android.apk.url'),
        sha256: normalizeSha256(apk.sha256, 'downloads.android.apk.sha256'),
        size: Number.isFinite(Number(apk.size)) ? Number(apk.size) : null,
      },
      certificateSha256: normalizeSha256(
        android.signing?.certificateSha256,
        'downloads.android.signing.certificateSha256',
      ),
    },
  }
}

export async function sha256Hex(data, cryptoImplementation = globalThis.crypto) {
  if (!cryptoImplementation?.subtle) throw new UpdateError('crypto-unavailable', 'SHA-256 is unavailable')
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const digest = await cryptoImplementation.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function loadNativeRuntime() {
  const [{ isTauri }, { getVersion }, os] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/app'),
    import('@tauri-apps/plugin-os'),
  ])
  if (!isTauri()) return { native: false }
  return {
    native: true,
    version: await getVersion(),
    platform: os.platform(),
    architecture: os.arch(),
  }
}

function getStoredTimestamp(storage, key) {
  try {
    return storage?.getItem(key)
  } catch {
    return null
  }
}

function storeTimestamp(storage, key, timestamp) {
  try {
    storage?.setItem(key, String(timestamp))
  } catch {
    // Update checks remain functional when storage is unavailable.
  }
}

async function installAndroidApk(release, fetchFn, cryptoImplementation) {
  const response = await fetchFn(release.apk.url, { cache: 'no-store', redirect: 'follow' })
  if (!response.ok) throw new UpdateError('download-http', `APK download failed with HTTP ${response.status}`)
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_ANDROID_APK_BYTES) {
    throw new UpdateError('apk-too-large', 'The Android update exceeds the 30 MiB limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_ANDROID_APK_BYTES) {
    throw new UpdateError('apk-too-large', 'The Android update exceeds the 30 MiB limit')
  }
  const digest = await sha256Hex(bytes, cryptoImplementation)
  if (digest !== release.apk.sha256) {
    throw new UpdateError('checksum-mismatch', 'The downloaded APK failed SHA-256 verification')
  }

  const [{ appCacheDir, join }, { writeFile }, { openPath }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/plugin-opener'),
  ])
  const fileName = `Notide-${release.versionCode || 'update'}-arm64.apk`
  const filePath = await join(await appCacheDir(), fileName)
  await writeFile(filePath, bytes)
  await openPath(filePath)
  return { filePath, sha256: digest }
}

export function createNativeUpdateService(options = {}) {
  const manifestUrl = options.manifestUrl ?? DEFAULT_UPDATE_MANIFEST_URL
  const interval = options.interval ?? UPDATE_CHECK_INTERVAL_MS
  const retryInterval = options.retryInterval ?? UPDATE_RETRY_INTERVAL_MS
  const storageKey = options.storageKey ?? UPDATE_CHECK_STORAGE_KEY
  const storage = options.storage ?? globalThis.localStorage
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis)
  const now = options.now ?? (() => Date.now())
  const loadRuntime = options.loadRuntime ?? loadNativeRuntime
  const cryptoImplementation = options.cryptoImplementation ?? globalThis.crypto
  let inFlightCheck = null

  async function runCheck({ force = false } = {}) {
    const checkedAt = now()
    if (!force && !shouldCheckForUpdate(getStoredTimestamp(storage, storageKey), checkedAt, interval)) {
      return { status: 'throttled', available: false }
    }
    const completeCheck = (result) => {
      storeTimestamp(storage, storageKey, checkedAt)
      return result
    }

    const runtime = await loadRuntime()
    if (!runtime.native) return { status: 'unsupported', available: false }

    if (runtime.platform === 'windows') {
      const [{ check }, { relaunch }] = await Promise.all([
        import('@tauri-apps/plugin-updater'),
        import('@tauri-apps/plugin-process'),
      ])
      const update = await check({ timeout: 15_000 })
      if (!update) return completeCheck({ status: 'current', available: false, currentVersion: runtime.version })
      return completeCheck({
        status: 'available',
        available: true,
        currentVersion: runtime.version,
        version: update.version,
        notes: update.body ?? '',
        install: async (onProgress) => {
          await update.downloadAndInstall(onProgress, { timeout: 120_000 })
          await relaunch()
        },
      })
    }

    if (runtime.platform === 'android') {
      if (!fetchFn) throw new UpdateError('network-unavailable', 'Fetch is unavailable')
      const response = await fetchFn(manifestUrl, { cache: 'no-store', redirect: 'follow' })
      if (!response.ok) throw new UpdateError('manifest-http', `Update check failed with HTTP ${response.status}`)
      const manifest = parseUpdateManifest(await response.json())
      if (!['aarch64', 'arm64', 'arm64-v8a'].includes(runtime.architecture)) {
        throw new UpdateError('unsupported-architecture', `No Android update is available for ${runtime.architecture}`)
      }
      if (manifest.android.architecture !== 'arm64-v8a') {
        throw new UpdateError('invalid-manifest', 'The Android update architecture is not arm64-v8a')
      }
      if (compareVersions(manifest.version, runtime.version) <= 0) {
        return completeCheck({ status: 'current', available: false, currentVersion: runtime.version })
      }
      return completeCheck({
        status: 'available',
        available: true,
        currentVersion: runtime.version,
        version: manifest.version,
        notes: manifest.notes,
        publishedAt: manifest.publishedAt,
        certificateSha256: manifest.android.certificateSha256,
        install: () => installAndroidApk(manifest.android, fetchFn, cryptoImplementation),
      })
    }

    return completeCheck({ status: 'unsupported', available: false, platform: runtime.platform })
  }

  function checkForUpdates(checkOptions = {}) {
    if (inFlightCheck) return inFlightCheck
    const request = runCheck(checkOptions).finally(() => {
      if (inFlightCheck === request) inFlightCheck = null
    })
    inFlightCheck = request
    return request
  }

  function startScheduledChecks({ onResult = () => {}, onError = () => {} } = {}) {
    let stopped = false
    let timer = null
    const schedule = (delay) => {
      if (!stopped) timer = setTimeout(run, delay)
    }
    const run = () => checkForUpdates().then((result) => {
      if (stopped) return
      onResult(result)
      const lastCheckedAt = Number(getStoredTimestamp(storage, storageKey))
      const nextDelay = result.status === 'throttled' && Number.isFinite(lastCheckedAt)
        ? Math.max(1_000, interval - (now() - lastCheckedAt))
        : interval
      schedule(nextDelay)
    }, (error) => {
      if (stopped) return
      onError(error)
      schedule(retryInterval)
    })
    void run()
    return () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
    }
  }

  return { checkForUpdates, startScheduledChecks }
}
