import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function parseArguments(argumentsList) {
  const values = {}
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    values[key.slice(2)] = value
  }
  return values
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(target) : [target]
  })
}

function exactlyOne(files, predicate, label) {
  const matches = files.filter(predicate)
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}, found ${matches.length}`)
  return matches[0]
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function digestFile(file, label) {
  const digest = fs.readFileSync(file, 'utf8').trim().replaceAll(':', '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} is not a SHA-256 digest`)
  return digest
}

function updaterSignature(file) {
  const value = fs.readFileSync(file, 'utf8').trim()
  if (!value) throw new Error('The Tauri updater signature is empty')
  return value.startsWith('untrusted comment:') ? Buffer.from(`${value}\n`).toString('base64') : value
}

function releaseUrl(baseUrl, file) {
  return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(path.basename(file))}`
}

function fileEntry(baseUrl, file) {
  return {
    url: releaseUrl(baseUrl, file),
    sha256: sha256(file),
    size: fs.statSync(file).size,
  }
}

export function createUpdateManifest({
  version,
  tag = `v${version}`,
  assetsDirectory,
  baseUrl = `https://github.com/kingshot101/Notide/releases/download/${tag}`,
  notes = '',
  publishedAt = new Date().toISOString(),
  androidVersionCode,
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error('A semantic --version is required')
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match v${version}`)
  if (new URL(baseUrl).protocol !== 'https:') throw new Error('Release base URL must use HTTPS')
  if (!Number.isInteger(androidVersionCode) || androidVersionCode < 1) throw new Error('androidVersionCode must be a positive integer')
  const date = new Date(publishedAt)
  if (Number.isNaN(date.valueOf())) throw new Error('publishedAt is invalid')

  const files = listFiles(assetsDirectory)
  const windowsExe = exactlyOne(files, (file) => /\.exe$/i.test(file), 'Windows EXE')
  const windowsMsi = exactlyOne(files, (file) => /\.msi$/i.test(file), 'Windows MSI')
  const updaterSig = exactlyOne(files, (file) => path.basename(file) === `${path.basename(windowsExe)}.sig`, 'Tauri updater signature')
  const androidApk = exactlyOne(files, (file) => /\.apk$/i.test(file), 'Android APK')
  const androidAab = exactlyOne(files, (file) => /\.aab$/i.test(file), 'Android AAB')
  const windowsCertificate = exactlyOne(files, (file) => path.basename(file) === 'windows-cert-sha256.txt', 'Windows certificate digest')
  const androidCertificate = exactlyOne(files, (file) => path.basename(file) === 'android-cert-sha256.txt', 'Android certificate digest')
  const signature = updaterSignature(updaterSig)
  const updater = { ...fileEntry(baseUrl, windowsExe), signature, format: 'nsis' }

  return {
    schemaVersion: 1,
    version,
    notes,
    pub_date: date.toISOString(),
    platforms: {
      'windows-x86_64': { signature, url: updater.url },
    },
    downloads: {
      windows: {
        architecture: 'x86_64',
        updater,
        installers: {
          exe: fileEntry(baseUrl, windowsExe),
          msi: fileEntry(baseUrl, windowsMsi),
        },
        signing: {
          scheme: 'Authenticode',
          digestAlgorithm: 'sha256',
          certificateSha256: digestFile(windowsCertificate, 'Windows certificate digest'),
        },
      },
      android: {
        architecture: 'arm64-v8a',
        versionCode: androidVersionCode,
        apk: fileEntry(baseUrl, androidApk),
        aab: fileEntry(baseUrl, androidAab),
        signing: {
          scheme: 'Android APK Signature Scheme',
          certificateSha256: digestFile(androidCertificate, 'Android certificate digest'),
        },
      },
    },
  }
}

export function main(argumentsList = process.argv.slice(2)) {
  const args = parseArguments(argumentsList)
  for (const key of ['version', 'assets', 'output', 'notes-file']) {
    if (!args[key]) throw new Error(`--${key} is required`)
  }
  const manifest = createUpdateManifest({
    version: args.version,
    tag: args.tag,
    assetsDirectory: path.resolve(args.assets),
    baseUrl: args['base-url'],
    notes: fs.readFileSync(path.resolve(args['notes-file']), 'utf8').trim(),
    publishedAt: args['published-at'],
    androidVersionCode: JSON.parse(fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8')).bundle.android.versionCode,
  })
  const output = path.resolve(args.output)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`Created update manifest for Notide ${manifest.version} at ${output}\n`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
