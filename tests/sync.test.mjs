import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSyncEndpoint, syncWorkspace, testSyncConnection } from '../src/sync.js'

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

test('normalizes a pasted collection URL before syncing', async () => {
  const calls = []
  await syncWorkspace({
    endpoint: 'https://sync.example/api/notes/',
    notes: [],
    fetchImpl: async (url) => {
      calls.push(url)
      return response({ notes: [], deleted: [] })
    },
  })

  assert.deepEqual(calls, ['https://sync.example/api/notes'])
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

test('normalizes sync endpoints and rejects unsafe remote HTTP URLs', () => {
  assert.equal(normalizeSyncEndpoint(' https://sync.example/api/notes/ '), 'https://sync.example')
  assert.equal(normalizeSyncEndpoint('http://localhost:8787/'), 'http://localhost:8787')
  assert.throws(
    () => normalizeSyncEndpoint('http://sync.example'),
    (error) => error.code === 'sync_endpoint_insecure',
  )
  assert.throws(
    () => normalizeSyncEndpoint('https://sync.example?token=secret'),
    (error) => error.code === 'sync_endpoint_invalid',
  )
})

test('tests the authenticated health endpoint without mutating notes', async () => {
  const calls = []
  const result = await testSyncConnection({
    endpoint: 'https://sync.example/',
    token: 'test-token',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      return response({ ok: true, service: 'notide-sync', version: 1, storage: 'ready' })
    },
  })

  assert.deepEqual(result, {
    ok: true,
    endpoint: 'https://sync.example',
    service: 'notide-sync',
    version: 1,
    storage: 'ready',
    legacy: false,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://sync.example/api/health')
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-token')
  assert.equal(calls[0].options.body, undefined)
  assert.equal(calls[0].options.method, 'GET')
})

test('falls back to a read-only collection check for an older Worker', async () => {
  const calls = []
  const result = await testSyncConnection({
    endpoint: 'https://sync.example',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/api/health')) return response({ ok: true, service: 'notide-sync', version: 1 })
      return response({ notes: [], deleted: [], truncated: false, cursor: null })
    },
  })

  assert.equal(result.legacy, true)
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://sync.example/api/health',
    'https://sync.example/api/notes',
  ])
  assert.equal(calls.every(({ options }) => options.body === undefined && options.method === 'GET'), true)
})

test('reports authentication, storage, and network connection failures separately', async (context) => {
  await context.test('authentication', async () => {
    await assert.rejects(
      testSyncConnection({ endpoint: 'https://sync.example', fetchImpl: async () => response({ error: 'unauthorized' }, 401) }),
      (error) => error.code === 'sync_auth_unauthorized' && error.status === 401,
    )
  })

  await context.test('storage', async () => {
    await assert.rejects(
      testSyncConnection({ endpoint: 'https://sync.example', fetchImpl: async () => response({ error: 'storage_unavailable' }, 503) }),
      (error) => error.code === 'sync_storage_unavailable' && error.status === 503,
    )
  })

  await context.test('network or CORS', async () => {
    await assert.rejects(
      testSyncConnection({ endpoint: 'https://sync.example', fetchImpl: async () => { throw new TypeError('Failed to fetch') } }),
      (error) => error.code === 'sync_network_or_cors' && error.cause instanceof TypeError,
    )
  })
})
