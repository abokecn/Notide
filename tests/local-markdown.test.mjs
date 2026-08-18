import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildImportedMarkdownNote,
  deriveMarkdownTitle,
  firstMarkdownHeading,
  isMarkdownFileName,
  MARKDOWN_FILE_ACCEPT,
  markdownByteLength,
  markdownDownloadName,
  validateMarkdownContent,
  validateMarkdownFile,
} from '../src/localMarkdown.js'

test('local Markdown validation accepts supported extensions and enforces the sync size limit', () => {
  for (const name of ['note.md', 'NOTE.MARKDOWN', 'entry.mdown', 'draft.mkd']) assert.equal(isMarkdownFileName(name), true)
  for (const name of ['note.txt', 'note.md.exe', '', 'README']) assert.equal(isMarkdownFileName(name), false)
  assert.equal(MARKDOWN_FILE_ACCEPT, '.md,.markdown,.mdown,.mkd,text/markdown')
  assert.equal(validateMarkdownFile({ name: 'note.md', size: 1024 * 1024 }), '')
  assert.equal(validateMarkdownFile({ name: 'note.md', size: 1024 * 1024 + 1 }), 'too-large')
  assert.equal(validateMarkdownFile({ name: 'note.txt', size: 4 }), 'unsupported')
  assert.equal(markdownByteLength('你好'), 6)
  assert.equal(validateMarkdownContent('x'.repeat(1024 * 1024 + 1)), 'too-large')
})

test('imported notes use the first real H1 and preserve source bytes exactly', () => {
  const content = '\uFEFF---\r\ntitle: metadata\r\n---\r\n```md\r\n# Not this one\r\n```\r\n# **Actual** [title](https://example.com) ##\r\nBody\r\n'
  assert.equal(firstMarkdownHeading(content), 'Actual title')
  assert.equal(deriveMarkdownTitle('No heading\n', 'weekly.review.MD'), 'weekly.review')

  const note = buildImportedMarkdownNote({
    id: 'local-1',
    fileName: 'source.md',
    content,
    folder: 'Local files',
    now: 1234,
  })
  assert.deepEqual(note, {
    id: 'local-1',
    title: 'Actual title',
    folder: 'Local files',
    favorite: false,
    pinned: false,
    archived: false,
    updatedAt: 1234,
    content,
  })
})

test('download names are portable across Windows, Android, and the web', () => {
  assert.equal(markdownDownloadName('Project: notes?'), 'Project- notes-.md')
  assert.equal(markdownDownloadName('CON'), '_CON.md')
  assert.equal(markdownDownloadName('meeting.markdown'), 'meeting.md')
  assert.equal(markdownDownloadName('   ', 'Untitled note'), 'Untitled note.md')
})

test('the application exposes accessible import and export actions with a native multi-file picker', () => {
  const app = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /type="file"[^>]*:accept="MARKDOWN_FILE_ACCEPT"[^>]*multiple[^>]*@change="importMarkdownFiles"/)
  assert.match(app, /:aria-label="t\.openMarkdown"[^>]*@click="openMarkdownFiles"/)
  assert.match(app, /:aria-label="t\.exportMarkdown"[^>]*@click="exportActiveMarkdown"/)
  assert.match(app, /\(event\.metaKey \|\| event\.ctrlKey\) && key === 'o'/)
  assert.match(app, /aria-live="fileNotice\.kind === 'error' \? 'assertive' : 'polite'"/)
})
