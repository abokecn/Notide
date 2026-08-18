import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')
const pngSize = (path) => {
  const bytes = fs.readFileSync(new URL(path, root))
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('native clients are configured for Tauri desktop and Android builds', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'))
  const packageJson = JSON.parse(read('package.json'))
  const workflow = read('.github/workflows/build.yml')
  const workflowDocument = YAML.parseDocument(workflow)
  const cargo = read('src-tauri/Cargo.toml')
  const app = read('src/App.vue')

  assert.deepEqual(workflowDocument.errors, [])
  assert.deepEqual(Object.keys(workflowDocument.toJS().jobs), ['web', 'windows', 'android'])
  assert.equal(config.productName, 'Notide')
  assert.equal(config.bundle.active, true)
  assert.equal(config.identifier, 'com.abokecn.notide')
  assert.equal(packageJson.name, 'notide')
  assert.equal(packageJson.scripts.tauri, 'tauri')
  assert.match(cargo, /name = "notide"/)
  assert.match(cargo, /name = "notide_lib"/)
  assert.match(cargo, /\[profile\.release\][\s\S]*opt-level = "s"[\s\S]*lto = "thin"[\s\S]*codegen-units = 1[\s\S]*strip = "symbols"/)
  assert.equal(packageJson.scripts['native:android:init'], 'tauri android init')
  assert.equal(packageJson.scripts['native:android'], 'tauri android build --ci --debug --apk')
  assert.equal(packageJson.scripts['native:android:release'], 'tauri android build --ci --apk --aab')
  assert.match(workflow, /npx tauri android init/)
  assert.match(workflow, /npm run native:android -- --target aarch64 --verbose/)
  assert.match(workflow, /cp -R src-tauri\/icons\/android\/\. src-tauri\/gen\/android\/app\/src\/main\/res\//)
  assert.match(workflow, /platforms;android-36/)
  assert.match(workflow, /build-tools;36\.0\.0/)
  assert.match(workflow, /NDK_HOME=.*29\.0\.13846066/)
  assert.match(workflow, /ANDROID_NDK_HOME=.*29\.0\.13846066/)
  assert.match(workflow, /android-build\.log/)
  assert.match(workflow, /::error title=Android build failure::/)
  assert.match(workflow, /::error title=Android post-Rust failure::/)
  assert.match(workflow, /> Task :app:rustBuildArm64Debug/)
  assert.match(workflow, /::error title=Android Gradle failure::/)
  assert.match(workflow, /::error title=Android matched errors::/)
  assert.match(workflow, /tail -c 3500/)
  assert.match(workflow, /notide-android-build-log/)
  assert.match(workflow, /CARGO_PROFILE_DEV_DEBUG: '0'/)
  assert.match(workflow, /CARGO_PROFILE_DEV_STRIP: symbols/)
  assert.match(workflow, /check-bundle-size\.mjs web dist[\s\S]*--max-total-mib 6[\s\S]*--max-preview-gzip-kib 90/)
  assert.match(workflow, /Expected exactly one debug APK/)
  assert.match(workflow, /apksigner" verify --verbose "\$\{debug_apks\[0\]\}"/)
  assert.match(workflow, /check-bundle-size\.mjs apk "\$\{debug_apks\[0\]\}" --max-apk-mib 30 --required-abi arm64-v8a/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /notide-windows/)
  assert.match(workflow, /notide-android/)
  assert.match(workflow, /if-no-files-found: error/g)
  assert.match(workflow, /outputs\/apk\/\*\*\/\*-debug\.apk/)
  assert.match(workflow, /ANDROID_KEY_BASE64: \$\{\{ secrets\.ANDROID_KEY_BASE64 \}\}/)
  assert.match(workflow, /ANDROID_KEY_ALIAS: \$\{\{ secrets\.ANDROID_KEY_ALIAS \}\}/)
  assert.match(workflow, /ANDROID_KEY_PASSWORD: \$\{\{ secrets\.ANDROID_KEY_PASSWORD \}\}/)
  assert.match(workflow, /Android release signing is incomplete/)
  assert.match(workflow, /steps\.android-release\.outputs\.enabled == 'true'/)
  assert.match(workflow, /signingConfig = signingConfigs\.getByName/)
  assert.match(workflow, /npm run native:android:release -- --target aarch64 --verbose/)
  assert.match(workflow, /apksigner" verify --verbose --print-certs/)
  assert.match(workflow, /jarsigner -verify/)
  assert.match(workflow, /name: notide-android-release/)
  assert.match(workflow, /outputs\/apk\/\*\*\/\*-release\.apk/)
  assert.match(workflow, /outputs\/bundle\/\*\*\/\*\.aab/)
  assert.ok(fs.existsSync(new URL('src-tauri/icons/android/mipmap-mdpi/ic_launcher.png', root)))
  assert.deepEqual(pngSize('src-tauri/icons/android/mipmap-hdpi/ic_launcher.png'), [72, 72])
  assert.deepEqual(pngSize('src-tauri/icons/android/mipmap-hdpi/ic_launcher_round.png'), [72, 72])
  assert.ok(fs.existsSync(new URL('src-tauri/icons/icon.ico', root)))
  const icon = read('public/notide-icon.svg')
  assert.match(icon, /rx="228"/)
  assert.doesNotMatch(icon, /<text\b/)
  assert.doesNotMatch(icon, /(?:href|xlink:href)=/)
  assert.ok(fs.existsSync(new URL('src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png', root)))
  assert.ok(fs.existsSync(new URL('src-tauri/icons/android/mipmap-mdpi/ic_launcher_background.png', root)))
  assert.match(app, /const STORAGE_KEY = 'notide-notes-v01'/)
  assert.match(app, /LEGACY_STORAGE_KEY = 'sail-markdown-notes-v01'/)
  assert.match(app, /pinned: Boolean|note\.pinned|pinned: false/)
  assert.match(app, /event\.metaKey \|\| event\.ctrlKey/)
})

test('Android release signing injector patches the generated Gradle structure', (t) => {
  const workflow = YAML.parse(read('.github/workflows/build.yml'))
  const configureStep = workflow.jobs.android.steps.find((step) => step.name === 'Configure Android release signing')
  const scriptMatch = configureStep?.run.match(/node --input-type=module -e '\n([\s\S]*?)\n'\n?$/)
  assert.ok(scriptMatch, 'release signing injector was not found in the Android workflow')

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notide-signing-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const appDirectory = path.join(directory, 'src-tauri', 'gen', 'android', 'app')
  fs.mkdirSync(appDirectory, { recursive: true })
  const gradleFile = path.join(appDirectory, 'build.gradle.kts')
  fs.writeFileSync(gradleFile, `android {
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`)

  execFileSync(process.execPath, ['--input-type=module', '--eval', scriptMatch[1]], { cwd: directory })
  const patched = fs.readFileSync(gradleFile, 'utf8')
  assert.match(patched, /signingConfigs \{[\s\S]*create\("release"\)/)
  assert.match(patched, /getByName\("release"\) \{\n\s+signingConfig = signingConfigs\.getByName\("release"\)/)
})
