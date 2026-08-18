import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_UPDATER_ENDPOINT = 'https://github.com/abokecn/Notide/releases/latest/download/latest.json'

export function createTauriReleaseConfig(environment = process.env) {
  const required = ['WINDOWS_CERT_THUMBPRINT', 'TAURI_UPDATER_PUBLIC_KEY']
  const missing = required.filter((name) => !environment[name])
  if (missing.length) throw new Error(`Missing release configuration: ${missing.join(', ')}`)
  const thumbprint = environment.WINDOWS_CERT_THUMBPRINT.replaceAll(/\s/g, '').toUpperCase()
  if (!/^[A-F0-9]{40}$/.test(thumbprint)) throw new Error('WINDOWS_CERT_THUMBPRINT must be a SHA-1 certificate thumbprint')
  const endpoint = environment.NOTIDE_UPDATER_ENDPOINT || DEFAULT_UPDATER_ENDPOINT
  if (new URL(endpoint).protocol !== 'https:') throw new Error('The updater endpoint must use HTTPS')
  return {
    bundle: {
      createUpdaterArtifacts: true,
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: 'sha256',
        timestampUrl: 'http://timestamp.digicert.com',
      },
    },
    plugins: {
      updater: {
        pubkey: environment.TAURI_UPDATER_PUBLIC_KEY,
        endpoints: [endpoint],
        windows: { installMode: 'passive' },
      },
    },
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    const outputIndex = process.argv.indexOf('--output')
    if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('Usage: create-tauri-release-config --output <path>')
    const output = path.resolve(process.argv[outputIndex + 1])
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, `${JSON.stringify(createTauriReleaseConfig(), null, 2)}\n`)
    process.stdout.write(`Created Tauri release configuration at ${output}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
