import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { configureAndroidRelease } from '../tools/configure-android-release.mjs'
import { createTauriReleaseConfig } from '../tools/create-tauri-release-config.mjs'
import { createUpdateManifest } from '../tools/create-update-manifest.mjs'
import { prepareAndroidProject } from '../tools/prepare-android-project.mjs'
import { verifyReleaseVersion } from '../tools/verify-release-version.mjs'

const root = new URL('..', import.meta.url)
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8')
const parseWorkflow = (file) => {
  const document = YAML.parseDocument(read(file))
  assert.deepEqual(document.errors, [])
  return document.toJS()
}

test('Tauri clients use the v0.4.0 identity, Android build number, and official native plugins', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'))
  const cargo = read('src-tauri/Cargo.toml')
  const library = read('src-tauri/src/lib.rs')
  const defaultCapability = JSON.parse(read('src-tauri/capabilities/default.json'))
  const androidCapability = JSON.parse(read('src-tauri/capabilities/android-update.json'))
  const desktopCapability = JSON.parse(read('src-tauri/capabilities/desktop-update.json'))
  const result = verifyReleaseVersion({ tag: 'v0.4.0', projectRoot: fileURLToPath(root) })

  assert.equal(config.productName, 'Notide')
  assert.equal(config.identifier, 'com.abokecn.notide')
  assert.equal(config.version, '0.4.0')
  assert.equal(config.bundle.android.versionCode, 40000)
  assert.equal(result.version, '0.4.0')
  assert.match(cargo, /version = "0\.4\.0"/)
  for (const plugin of ['fs', 'opener', 'os', 'process', 'updater']) {
    assert.match(cargo, new RegExp(`tauri-plugin-${plugin} = "2"`))
    assert.match(library, new RegExp(`tauri_plugin_${plugin}`))
  }
  assert.equal(config.app.security.csp.includes("default-src 'self'"), true)
  assert.equal(defaultCapability.permissions.includes('fs:allow-write-file'), false)
  assert.deepEqual(androidCapability.platforms, ['android'])
  assert.ok(androidCapability.permissions.includes('fs:allow-write-file'))
  assert.equal(androidCapability.permissions.some((permission) => permission.identifier === 'opener:allow-open-path'), true)
  assert.deepEqual(desktopCapability.platforms, ['windows'])
  assert.ok(desktopCapability.permissions.includes('updater:default'))
})

test('main workflow compiles but never uploads a debug package', () => {
  const source = read('.github/workflows/build.yml')
  const workflow = parseWorkflow('.github/workflows/build.yml')
  assert.deepEqual(Object.keys(workflow.jobs), ['web', 'windows-check', 'android-check'])
  assert.match(source, /tauri build --no-bundle -- --locked/)
  assert.match(source, /Compile Android check APK without publishing it/)
  assert.match(source, /tauri android init --ci --skip-targets-install/)
  assert.match(source, /CARGO_PROFILE_DEV_STRIP: symbols/)
  assert.match(source, /native:android -- --target aarch64 --verbose -- --locked/)
  assert.match(source, /--max-apk-mib 30 --required-abi arm64-v8a/)
  assert.doesNotMatch(source, /actions\/upload-artifact/)
})

test('tag workflow fails closed and publishes only verified signed artifacts', () => {
  const source = read('.github/workflows/release.yml')
  const workflow = parseWorkflow('.github/workflows/release.yml')
  assert.deepEqual(Object.keys(workflow.jobs), ['release-gate', 'windows', 'android', 'publish'])
  assert.deepEqual(workflow.on.push.tags, ['v*'])
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.jobs.publish.permissions.contents, 'write')
  for (const secret of [
    'WINDOWS_PFX_BASE64',
    'WINDOWS_PFX_PASSWORD',
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'TAURI_UPDATER_PUBLIC_KEY',
    'ANDROID_KEY_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(source, new RegExp(`secrets\\.${secret}`))
  }
  assert.match(source, /Signed release blocked/)
  assert.match(source, /tauri build --config .* -- --locked/)
  assert.match(source, /native:android:release -- --target aarch64 --verbose -- --locked/)
  assert.match(source, /Get-AuthenticodeSignature/)
  assert.match(source, /minisign -Vm/)
  assert.match(source, /apksigner" verify --verbose --print-certs/)
  assert.match(source, /ANDROID_EXPECTED_CERT_SHA256/)
  assert.match(source, /jarsigner -verify/)
  assert.match(source, /keytool -printcert -jarfile/)
  assert.match(source, /name: notide-windows/)
  assert.match(source, /name: notide-android/)
  assert.match(source, /if-no-files-found: error/g)
  assert.match(source, /create-update-manifest\.mjs/)
  assert.match(source, /release-assets\/latest\.json/)
  assert.doesNotMatch(source, /--debug/)
})

test('Android project preparation is idempotent and release signing targets only release builds', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notide-android-project-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const androidRoot = path.join(directory, 'src-tauri', 'gen', 'android')
  const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml')
  const gradlePath = path.join(androidRoot, 'app', 'build.gradle.kts')
  const iconPath = path.join(directory, 'src-tauri', 'icons', 'android', 'mipmap-mdpi', 'ic_launcher.png')
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.mkdirSync(path.dirname(iconPath), { recursive: true })
  fs.writeFileSync(iconPath, 'icon')
  fs.writeFileSync(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application />\n</manifest>\n')
  fs.writeFileSync(gradlePath, `android {
    buildTypes {
        getByName("debug") {}
        getByName("release") {
            isMinifyEnabled = false
        }
    }
}
`)

  prepareAndroidProject(directory)
  prepareAndroidProject(directory)
  const preparedManifest = fs.readFileSync(manifestPath, 'utf8')
  assert.equal((preparedManifest.match(/REQUEST_INSTALL_PACKAGES/g) ?? []).length, 1)
  assert.equal(fs.readFileSync(path.join(androidRoot, 'app', 'src', 'main', 'res', 'mipmap-mdpi', 'ic_launcher.png'), 'utf8'), 'icon')

  const environment = {
    ANDROID_KEY_BASE64: Buffer.from('keystore fixture').toString('base64'),
    ANDROID_KEYSTORE_PASSWORD: 'store-password',
    ANDROID_KEY_ALIAS: 'notide',
    ANDROID_KEY_PASSWORD: 'key-password',
    RUNNER_TEMP: path.join(directory, 'runner-temp'),
  }
  configureAndroidRelease({ projectRoot: directory, environment })
  configureAndroidRelease({ projectRoot: directory, environment })
  const gradle = fs.readFileSync(gradlePath, 'utf8')
  assert.equal((gradle.match(/NOTIDE_RELEASE_SIGNING/g) ?? []).length, 1)
  assert.match(gradle, /getByName\("release"\) \{\n\s+signingConfig = signingConfigs\.getByName\("release"\)/)
  assert.doesNotMatch(gradle, /getByName\("debug"\) \{\s*signingConfig/)
})

test('release config requires a signing identity and enables Tauri updater artifacts', () => {
  const config = createTauriReleaseConfig({
    WINDOWS_CERT_THUMBPRINT: 'a'.repeat(40),
    TAURI_UPDATER_PUBLIC_KEY: 'public-key-fixture',
  })
  assert.equal(config.bundle.createUpdaterArtifacts, true)
  assert.equal(config.bundle.windows.digestAlgorithm, 'sha256')
  assert.match(config.plugins.updater.endpoints[0], /releases\/latest\/download\/latest\.json/)
  assert.throws(() => createTauriReleaseConfig({}), /Missing release configuration/)
})

test('release manifest hashes every platform asset and carries both signing identities', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notide-release-assets-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const fixtureFiles = {
    'Notide_0.4.0_x64-setup.exe': 'signed exe',
    'Notide_0.4.0_x64-setup.exe.sig': 'updater-signature',
    'Notide_0.4.0_x64.msi': 'signed msi',
    'Notide_0.4.0_arm64.apk': 'signed apk',
    'Notide_0.4.0_arm64.aab': 'signed aab',
    'windows-cert-sha256.txt': 'b'.repeat(64),
    'android-cert-sha256.txt': 'c'.repeat(64),
  }
  for (const [name, contents] of Object.entries(fixtureFiles)) fs.writeFileSync(path.join(directory, name), contents)

  const result = createUpdateManifest({
    version: '0.4.0',
    tag: 'v0.4.0',
    assetsDirectory: directory,
    notes: 'Notide release notes',
    publishedAt: '2026-08-18T00:00:00Z',
    androidVersionCode: 40000,
  })
  const expectedApkHash = crypto.createHash('sha256').update('signed apk').digest('hex')
  assert.equal(result.version, '0.4.0')
  assert.equal(result.downloads.android.versionCode, 40000)
  assert.equal(result.downloads.android.apk.sha256, expectedApkHash)
  assert.equal(result.downloads.android.signing.certificateSha256, 'c'.repeat(64))
  assert.equal(result.downloads.windows.signing.certificateSha256, 'b'.repeat(64))
  assert.equal(result.platforms['windows-x86_64'].signature, 'updater-signature')
  assert.match(result.platforms['windows-x86_64'].url, /^https:\/\//)
})

test('platform icon resources remain available for signed packages', () => {
  assert.equal(fs.existsSync(new URL('src-tauri/icons/icon.ico', root)), true)
  assert.equal(fs.existsSync(new URL('src-tauri/icons/icon.icns', root)), true)
  assert.equal(fs.existsSync(new URL('src-tauri/icons/android/mipmap-mdpi/ic_launcher.png', root)), true)
  assert.equal(fs.existsSync(new URL('src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png', root)), true)
})
