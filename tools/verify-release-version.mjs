import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function readReleaseVersions(projectRoot = root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const tauri = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const cargo = fs.readFileSync(path.join(projectRoot, 'src-tauri', 'Cargo.toml'), 'utf8')
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!cargoVersion) throw new Error('Cargo package version was not found')
  return {
    packageVersion: packageJson.version,
    tauriVersion: tauri.version,
    cargoVersion,
    androidVersionCode: tauri.bundle?.android?.versionCode,
  }
}

export function verifyReleaseVersion({ tag, projectRoot = root } = {}) {
  const versions = readReleaseVersions(projectRoot)
  const uniqueVersions = new Set([
    versions.packageVersion,
    versions.tauriVersion,
    versions.cargoVersion,
  ])
  if (uniqueVersions.size !== 1) {
    throw new Error(`Release versions differ: ${JSON.stringify(versions)}`)
  }
  if (!Number.isInteger(versions.androidVersionCode) || versions.androidVersionCode < 1) {
    throw new Error(`Android versionCode must be a positive integer, received ${versions.androidVersionCode}`)
  }
  const expectedTag = `v${versions.packageVersion}`
  if (tag && tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match ${expectedTag}`)
  }
  return { version: versions.packageVersion, tag: expectedTag, androidVersionCode: versions.androidVersionCode }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    const result = verifyReleaseVersion({ tag: process.argv[2] || process.env.GITHUB_REF_NAME })
    process.stdout.write(`Notide ${result.version} (Android ${result.androidVersionCode}) is release-ready.\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
