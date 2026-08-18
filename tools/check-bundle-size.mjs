import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const KIB = 1024
const MIB = 1024 * KIB

export const DEFAULT_WEB_BUDGETS = Object.freeze({
  totalRawBytes: 6 * MIB,
  editorRawBytes: 650 * KIB,
  editorGzipBytes: 220 * KIB,
  previewRawBytes: 250 * KIB,
  previewGzipBytes: 90 * KIB,
})

export const DEFAULT_APK_BUDGET = Object.freeze({
  maxApkBytes: 30 * MIB,
  requiredAbi: 'arm64-v8a',
})

function walkFiles(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(file))
    else if (entry.isFile()) files.push(file)
  }
  return files.sort()
}

function displayPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function gzipSize(file) {
  return gzipSync(fs.readFileSync(file), { level: 9 }).byteLength
}

function formatBytes(bytes) {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MiB`
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(1)} KiB`
  return `${bytes} B`
}

function findEditorEntries(directory) {
  const indexFile = path.join(directory, 'index.html')
  if (!fs.existsSync(indexFile)) throw new Error(`Missing web entry: ${indexFile}`)
  const html = fs.readFileSync(indexFile, 'utf8')
  const entries = []
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const source = match[1]
    if (/^(?:[a-z]+:)?\/\//i.test(source) || !source.split(/[?#]/)[0].endsWith('.js')) continue
    const clean = source.split(/[?#]/)[0].replace(/^\.?\//, '').replace(/^\//, '')
    entries.push(path.join(directory, ...clean.split('/')))
  }
  if (!entries.length) throw new Error(`No JavaScript entry found in ${indexFile}`)
  for (const entry of entries) if (!fs.existsSync(entry)) throw new Error(`Missing editor entry chunk: ${entry}`)
  return [...new Set(entries)]
}

function metric(files) {
  return {
    rawBytes: files.reduce((total, file) => total + fs.statSync(file).size, 0),
    gzipBytes: files.reduce((total, file) => total + gzipSize(file), 0),
  }
}

export function inspectWebBundle(directory, budgets = DEFAULT_WEB_BUDGETS) {
  const root = path.resolve(directory)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Web bundle directory not found: ${root}`)
  const files = walkFiles(root)
  const editorFiles = findEditorEntries(root)
  const previewFiles = files.filter((file) => /^MarkdownPreview-[\w-]+\.js$/.test(path.basename(file)))
  if (previewFiles.length !== 1) throw new Error(`Expected one MarkdownPreview chunk, found ${previewFiles.length}`)

  const totalRawBytes = files.reduce((total, file) => total + fs.statSync(file).size, 0)
  const editor = metric(editorFiles)
  const preview = metric(previewFiles)
  const primary = new Set([...editorFiles, ...previewFiles])
  const optional = files
    .filter((file) => !primary.has(file))
    .map((file) => ({ path: displayPath(root, file), rawBytes: fs.statSync(file).size }))
    .sort((a, b) => b.rawBytes - a.rawBytes)
    .slice(0, 10)
  const violations = []

  if (totalRawBytes > budgets.totalRawBytes) violations.push(`dist total ${formatBytes(totalRawBytes)} exceeds ${formatBytes(budgets.totalRawBytes)}`)
  if (editor.rawBytes > budgets.editorRawBytes) violations.push(`editor entry raw ${formatBytes(editor.rawBytes)} exceeds ${formatBytes(budgets.editorRawBytes)}`)
  if (editor.gzipBytes > budgets.editorGzipBytes) violations.push(`editor entry gzip ${formatBytes(editor.gzipBytes)} exceeds ${formatBytes(budgets.editorGzipBytes)}`)
  if (preview.rawBytes > budgets.previewRawBytes) violations.push(`preview base raw ${formatBytes(preview.rawBytes)} exceeds ${formatBytes(budgets.previewRawBytes)}`)
  if (preview.gzipBytes > budgets.previewGzipBytes) violations.push(`preview base gzip ${formatBytes(preview.gzipBytes)} exceeds ${formatBytes(budgets.previewGzipBytes)}`)

  return {
    root,
    totalRawBytes,
    editor: { ...editor, files: editorFiles.map((file) => displayPath(root, file)) },
    preview: { ...preview, files: previewFiles.map((file) => displayPath(root, file)) },
    optional,
    violations,
  }
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) throw new Error('APK ZIP end-of-central-directory record not found')
  const minimum = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  throw new Error('APK ZIP end-of-central-directory record not found')
}

export function readZipEntries(file) {
  const buffer = fs.readFileSync(file)
  const end = findEndOfCentralDirectory(buffer)
  const disk = buffer.readUInt16LE(end + 4)
  const centralDisk = buffer.readUInt16LE(end + 6)
  const entryCount = buffer.readUInt16LE(end + 10)
  const centralOffset = buffer.readUInt32LE(end + 16)
  if (disk !== 0 || centralDisk !== 0) throw new Error('Multi-disk APK ZIP files are not supported')
  if (entryCount === 0xffff || centralOffset === 0xffffffff) throw new Error('ZIP64 APK files are not supported by the size gate')

  const entries = []
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Invalid APK central-directory entry at offset ${offset}`)
    const compressedBytes = buffer.readUInt32LE(offset + 20)
    const rawBytes = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, rawBytes, compressedBytes })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function inspectApk(file, budget = DEFAULT_APK_BUDGET) {
  const apk = path.resolve(file)
  if (!fs.existsSync(apk) || !fs.statSync(apk).isFile()) throw new Error(`APK not found: ${apk}`)
  const apkBytes = fs.statSync(apk).size
  const entries = readZipEntries(apk)
  const abiSet = new Set()
  for (const entry of entries) {
    const match = /^lib\/([^/]+)\/[^/]+\.so$/.exec(entry.name)
    if (match) abiSet.add(match[1])
  }
  const abis = [...abiSet].sort()
  const violations = []
  if (apkBytes >= budget.maxApkBytes) violations.push(`APK ${formatBytes(apkBytes)} must stay below ${formatBytes(budget.maxApkBytes)}`)
  if (!abis.includes(budget.requiredAbi)) violations.push(`APK is missing required ABI ${budget.requiredAbi}`)
  const unexpectedAbis = abis.filter((abi) => abi !== budget.requiredAbi)
  if (unexpectedAbis.length) violations.push(`APK contains unexpected ABIs: ${unexpectedAbis.join(', ')}`)

  return {
    apk,
    apkBytes,
    abis,
    largestEntries: [...entries].sort((a, b) => b.rawBytes - a.rawBytes).slice(0, 12),
    violations,
  }
}

function parseOptions(argumentsList) {
  const values = {}
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index]
    const value = argumentsList[index + 1]
    if (!key?.startsWith('--') || value == null) throw new Error(`Invalid option near ${key || '<end>'}`)
    values[key.slice(2)] = value
  }
  return values
}

function positiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`)
  return number
}

function printWeb(result, budgets) {
  console.log(`Web bundle: ${result.root}`)
  console.log(`  dist total       ${formatBytes(result.totalRawBytes)} / ${formatBytes(budgets.totalRawBytes)}`)
  console.log(`  editor entry     ${formatBytes(result.editor.rawBytes)} raw, ${formatBytes(result.editor.gzipBytes)} gzip`)
  console.log(`  preview base     ${formatBytes(result.preview.rawBytes)} raw, ${formatBytes(result.preview.gzipBytes)} gzip`)
  console.log(`  editor files     ${result.editor.files.join(', ')}`)
  console.log(`  preview files    ${result.preview.files.join(', ')}`)
  console.log('  largest lazy/optional files (reported, not individually capped):')
  for (const item of result.optional) console.log(`    ${formatBytes(item.rawBytes).padStart(10)}  ${item.path}`)
}

function printApk(result, budget) {
  console.log(`Android APK: ${result.apk}`)
  console.log(`  APK size         ${formatBytes(result.apkBytes)} / < ${formatBytes(budget.maxApkBytes)}`)
  console.log(`  native ABIs      ${result.abis.join(', ') || 'none'}`)
  console.log('  largest APK entries:')
  for (const entry of result.largestEntries) {
    console.log(`    ${formatBytes(entry.rawBytes).padStart(10)} raw  ${formatBytes(entry.compressedBytes).padStart(10)} packed  ${entry.name}`)
  }
}

export function main(argumentsList = process.argv.slice(2)) {
  const [kind, target, ...optionArguments] = argumentsList
  if (!kind || !target || !['web', 'apk'].includes(kind)) {
    throw new Error('Usage: node tools/check-bundle-size.mjs <web|apk> <path> [--budget value]')
  }
  const options = parseOptions(optionArguments)
  if (kind === 'web') {
    const budgets = {
      totalRawBytes: positiveNumber(options['max-total-mib'] ?? 6, 'max-total-mib') * MIB,
      editorRawBytes: positiveNumber(options['max-editor-raw-kib'] ?? 650, 'max-editor-raw-kib') * KIB,
      editorGzipBytes: positiveNumber(options['max-editor-gzip-kib'] ?? 220, 'max-editor-gzip-kib') * KIB,
      previewRawBytes: positiveNumber(options['max-preview-raw-kib'] ?? 250, 'max-preview-raw-kib') * KIB,
      previewGzipBytes: positiveNumber(options['max-preview-gzip-kib'] ?? 90, 'max-preview-gzip-kib') * KIB,
    }
    const result = inspectWebBundle(target, budgets)
    printWeb(result, budgets)
    if (result.violations.length) throw new Error(result.violations.join('\n'))
    return result
  }

  const budget = {
    maxApkBytes: positiveNumber(options['max-apk-mib'] ?? 30, 'max-apk-mib') * MIB,
    requiredAbi: options['required-abi'] || 'arm64-v8a',
  }
  const result = inspectApk(target, budget)
  printApk(result, budget)
  if (result.violations.length) throw new Error(result.violations.join('\n'))
  return result
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(`[bundle-size] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
