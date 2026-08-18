import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspectApk, inspectWebBundle, readZipEntries } from '../tools/check-bundle-size.mjs'

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notide-size-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function createStoredZip(file, sourceEntries, comment = Buffer.alloc(0)) {
  const localParts = []
  const centralParts = []
  let localOffset = 0

  for (const [name, source] of sourceEntries) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.isBuffer(source) ? source : Buffer.from(source)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, nameBytes)
    localOffset += local.length + nameBytes.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(sourceEntries.length, 8)
  end.writeUInt16LE(sourceEntries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  end.writeUInt16LE(comment.length, 20)
  fs.writeFileSync(file, Buffer.concat([...localParts, centralDirectory, end, comment]))
}

test('web bundle gate separates editor, preview, and optional chunks', (t) => {
  const directory = temporaryDirectory(t)
  const assets = path.join(directory, 'assets')
  fs.mkdirSync(assets)
  fs.writeFileSync(path.join(directory, 'index.html'), '<script type="module" src="/assets/index-test.js"></script>')
  fs.writeFileSync(path.join(assets, 'index-test.js'), 'const editor = true;')
  fs.writeFileSync(path.join(assets, 'MarkdownPreview-test.js'), 'const preview = true;')
  fs.writeFileSync(path.join(assets, 'mermaid-optional.js'), Buffer.alloc(300_000, 97))

  const result = inspectWebBundle(directory, {
    totalRawBytes: 400_000,
    editorRawBytes: 1_000,
    editorGzipBytes: 1_000,
    previewRawBytes: 1_000,
    previewGzipBytes: 1_000,
  })

  assert.deepEqual(result.violations, [])
  assert.deepEqual(result.editor.files, ['assets/index-test.js'])
  assert.deepEqual(result.preview.files, ['assets/MarkdownPreview-test.js'])
  assert.equal(result.optional[0].path, 'assets/mermaid-optional.js')
})

test('web bundle gate reports every exceeded primary budget', (t) => {
  const directory = temporaryDirectory(t)
  const assets = path.join(directory, 'assets')
  fs.mkdirSync(assets)
  fs.writeFileSync(path.join(directory, 'index.html'), '<script type="module" src="/assets/index-test.js"></script>')
  fs.writeFileSync(path.join(assets, 'index-test.js'), Buffer.alloc(2_000, 1))
  fs.writeFileSync(path.join(assets, 'MarkdownPreview-test.js'), Buffer.alloc(2_000, 2))

  const result = inspectWebBundle(directory, {
    totalRawBytes: 1,
    editorRawBytes: 1,
    editorGzipBytes: 1,
    previewRawBytes: 1,
    previewGzipBytes: 1,
  })

  assert.equal(result.violations.length, 5)
})

test('APK gate reads central entries and enforces a single ARM64 ABI', (t) => {
  const directory = temporaryDirectory(t)
  const apk = path.join(directory, 'app-debug.apk')
  createStoredZip(apk, [
    ['lib/arm64-v8a/libnotide_lib.so', Buffer.alloc(512)],
    ['classes.dex', Buffer.alloc(128)],
  ])

  assert.equal(readZipEntries(apk).length, 2)
  const result = inspectApk(apk, { maxApkBytes: 10_000, requiredAbi: 'arm64-v8a' })
  assert.deepEqual(result.abis, ['arm64-v8a'])
  assert.deepEqual(result.violations, [])
  assert.equal(result.largestEntries[0].name, 'lib/arm64-v8a/libnotide_lib.so')
})

test('APK gate rejects extra ABIs and the size ceiling', (t) => {
  const directory = temporaryDirectory(t)
  const apk = path.join(directory, 'app-debug.apk')
  createStoredZip(apk, [
    ['lib/arm64-v8a/libnotide_lib.so', Buffer.alloc(32)],
    ['lib/x86_64/libnotide_lib.so', Buffer.alloc(32)],
  ])

  const result = inspectApk(apk, { maxApkBytes: 1, requiredAbi: 'arm64-v8a' })
  assert.equal(result.violations.length, 2)
  assert.match(result.violations.join('\n'), /must stay below/)
  assert.match(result.violations.join('\n'), /unexpected ABIs: x86_64/)
})

test('APK ZIP parser ignores false end markers inside the archive comment', (t) => {
  const directory = temporaryDirectory(t)
  const apk = path.join(directory, 'app-commented.apk')
  const comment = Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(36)])
  createStoredZip(apk, [['lib/arm64-v8a/libnotide_lib.so', Buffer.alloc(16)]], comment)

  assert.equal(readZipEntries(apk).length, 1)
})
