import test from 'node:test'
import assert from 'node:assert/strict'
import { syncWorkspace } from '../src/sync.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

test('pulls a newer remote note and keeps local-only notes', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/api/notes')) return response({ notes: [{ id: 'remote', title: 'Remote', content: 'new', updatedAt: 20, revision: 2 }], deleted: [] })
    return response({ ok: true, note: JSON.parse(options.body) })
  }
  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes: [{ id: 'remote', title: 'Remote', content: 'old', updatedAt: 10 }, { id: 'local', title: 'Local', content: 'draft', updatedAt: 15 }],
    fetchImpl,
  })
  assert.equal(result.notes.find((note) => note.id === 'remote').content, 'new')
  assert.equal(result.notes.some((note) => note.id === 'local'), true)
  assert.equal(result.uploaded, 1)
  assert.equal(calls.length, 2)
})

test('uploads a newer local note with the remote revision', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/api/notes')) return response({ notes: [{ id: 'same', title: 'Old', content: 'old', updatedAt: 10, revision: 4 }], deleted: [] })
    assert.equal(options.headers['if-match'], '"4"')
    assert.equal(JSON.parse(options.body).pinned, true)
    return response({ ok: true, note: { id: 'same', title: 'New', content: 'new', pinned: true, updatedAt: 30, revision: 5 } })
  }
  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes: [{ id: 'same', title: 'New', content: 'new', pinned: true, updatedAt: 30 }],
    fetchImpl,
  })
  assert.equal(result.notes[0].revision, 5)
  assert.equal(result.uploaded, 1)
})

test('propagates a newer local delete as a remote delete', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/api/notes')) return response({ notes: [{ id: 'gone', title: 'Gone', content: 'x', updatedAt: 10, revision: 1 }], deleted: [] })
    assert.equal(options.method, 'DELETE')
    return response({ ok: true })
  }
  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes: [{ id: 'gone', title: 'Gone', content: 'x', updatedAt: 10 }],
    tombstones: [{ id: 'gone', deletedAt: 20 }],
    fetchImpl,
  })
  assert.equal(result.notes.length, 0)
  assert.equal(result.uploaded, 1)
})
