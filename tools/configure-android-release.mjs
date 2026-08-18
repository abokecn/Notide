import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '// NOTIDE_RELEASE_SIGNING'

function requireEnvironment(environment, names) {
  const missing = names.filter((name) => !environment[name])
  if (missing.length) throw new Error(`Missing Android signing values: ${missing.join(', ')}`)
}

function propertyValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}

export function configureAndroidRelease({ projectRoot = root, environment = process.env } = {}) {
  requireEnvironment(environment, [
    'ANDROID_KEY_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ])
  const androidRoot = path.join(projectRoot, 'src-tauri', 'gen', 'android')
  const gradlePath = path.join(androidRoot, 'app', 'build.gradle.kts')
  if (!fs.existsSync(gradlePath)) throw new Error('Generated Android Gradle project was not found')

  const temporaryRoot = environment.RUNNER_TEMP || path.join(androidRoot, '.notide-release')
  fs.mkdirSync(temporaryRoot, { recursive: true })
  const keystorePath = path.join(temporaryRoot, 'notide-release.jks')
  const keystore = Buffer.from(environment.ANDROID_KEY_BASE64, 'base64')
  if (!keystore.length) throw new Error('ANDROID_KEY_BASE64 is not valid base64 keystore data')
  fs.writeFileSync(keystorePath, keystore, { mode: 0o600 })

  const propertiesPath = path.join(androidRoot, 'keystore.properties')
  const properties = [
    `storeFile=${propertyValue(keystorePath)}`,
    `storePassword=${propertyValue(environment.ANDROID_KEYSTORE_PASSWORD)}`,
    `keyAlias=${propertyValue(environment.ANDROID_KEY_ALIAS)}`,
    `keyPassword=${propertyValue(environment.ANDROID_KEY_PASSWORD)}`,
    '',
  ].join('\n')
  fs.writeFileSync(propertiesPath, properties, { mode: 0o600 })

  let gradle = fs.readFileSync(gradlePath, 'utf8')
  if (!gradle.includes(MARKER)) {
    const buildTypes = /^(\s*)buildTypes\s*\{/m
    const buildTypesMatch = gradle.match(buildTypes)
    if (!buildTypesMatch) throw new Error('Android buildTypes block was not found')
    const indent = buildTypesMatch[1]
    const signingBlock = [
      `${indent}${MARKER}`,
      `${indent}signingConfigs {`,
      `${indent}    create("release") {`,
      `${indent}        val propertiesFile = rootProject.file("keystore.properties")`,
      `${indent}        val properties = java.util.Properties()`,
      `${indent}        properties.load(java.io.FileInputStream(propertiesFile))`,
      `${indent}        storeFile = file(properties["storeFile"] as String)`,
      `${indent}        storePassword = properties["storePassword"] as String`,
      `${indent}        keyAlias = properties["keyAlias"] as String`,
      `${indent}        keyPassword = properties["keyPassword"] as String`,
      `${indent}    }`,
      `${indent}}`,
      '',
    ].join('\n')
    gradle = gradle.replace(buildTypes, `${signingBlock}$&`)
    const releaseType = /(getByName\("release"\)\s*\{\s*\r?\n)/
    if (!releaseType.test(gradle)) throw new Error('Android release build type was not found')
    gradle = gradle.replace(releaseType, `$1${indent}        signingConfig = signingConfigs.getByName("release")\n`)
    fs.writeFileSync(gradlePath, gradle)
  }
  return { gradlePath, keystorePath, propertiesPath }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    configureAndroidRelease()
    process.stdout.write('Configured Android release signing.\n')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
