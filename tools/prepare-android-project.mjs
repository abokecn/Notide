import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL_PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES'

export function prepareAndroidProject(projectRoot = root) {
  const generatedRoot = path.join(projectRoot, 'src-tauri', 'gen', 'android')
  const iconSource = path.join(projectRoot, 'src-tauri', 'icons', 'android')
  const resourceDirectory = path.join(generatedRoot, 'app', 'src', 'main', 'res')
  const manifestPath = path.join(generatedRoot, 'app', 'src', 'main', 'AndroidManifest.xml')
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Android project is missing. Run `tauri android init` first.')
  }
  fs.cpSync(iconSource, resourceDirectory, { recursive: true, force: true })

  let manifest = fs.readFileSync(manifestPath, 'utf8')
  if (!manifest.includes(INSTALL_PERMISSION)) {
    const application = /^(\s*)<application\b/m
    const match = manifest.match(application)
    if (!match) throw new Error('Android manifest does not contain an application element')
    const permission = `${match[1]}<uses-permission android:name="${INSTALL_PERMISSION}" />\n`
    manifest = manifest.replace(application, `${permission}$&`)
    fs.writeFileSync(manifestPath, manifest)
  }
  return { manifestPath, resourceDirectory }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    const result = prepareAndroidProject(process.argv[2] ? path.resolve(process.argv[2]) : root)
    process.stdout.write(`Prepared Android resources and installer permission in ${result.manifestPath}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
