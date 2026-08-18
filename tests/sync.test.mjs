import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSyncEndpoint, syncWorkspace, testSyncConnection } from '../src/sync.js'

function response(body, status = 200, headers = {}) {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
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
    database: null,
    legacy: false,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://sync.example/api/health')
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-token')
  assert.equal(calls[0].options.body, undefined)
  assert.equal(calls[0].options.method, 'GET')
})

test('incremental no-op sync preserves note and tombstone references', async () => {
  const notes = [{ id: 'same', title: 'Same', content: 'same', updatedAt: 10, revision: 2 }]
  const tombstones = [{ id: 'gone', deletedAt: 8, revision: 1 }]
  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    token: 'session',
    ownerId: 'user-1',
    notes,
    tombstones,
    collectionVersion: 5,
    fetchImpl: async (url, options) => {
      assert.match(url, /ownerId=user-1/)
      assert.match(url, /since=5/)
      assert.equal(options.headers.authorization, 'Bearer session')
      return response({ notes: [], deleted: [], truncated: false, cursor: null, collectionVersion: 5 }, 200, {
        etag: '"notide-user-5"',
        'x-notide-version': '5',
      })
    },
  })
  assert.equal(result.notes, notes)
  assert.equal(result.tombstones, tombstones)
  assert.equal(result.changed, false)
  assert.equal(result.notModified, true)
  assert.equal(result.collectionVersion, 5)
})

test('collection ETag handles 304 without replacing local references', async () => {
  const notes = []
  const tombstones = []
  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes,
    tombstones,
    collectionEtag: '"notide-empty-0"',
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers['if-none-match'], '"notide-empty-0"')
      return response(null, 304, { etag: '"notide-empty-0"', 'x-notide-version': '0' })
    },
  })
  assert.equal(result.notes, notes)
  assert.equal(result.tombstones, tombstones)
  assert.equal(result.notModified, true)
})

test('pagination keeps only the highest revision when the same note changes between pages', async () => {
  let page = 0
  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes: [],
    fetchImpl: async (url) => {
      page += 1
      if (page === 1) {
        assert.equal(new URL(url).searchParams.has('cursor'), false)
        return response({
          notes: [],
          deleted: [{ id: 'reborn', deletedAt: 50, revision: 2 }],
          truncated: true,
          cursor: 'next-page',
          collectionVersion: 2,
        })
      }
      assert.equal(new URL(url).searchParams.get('cursor'), 'next-page')
      return response({
        notes: [{ id: 'reborn', title: 'Reborn', content: 'latest', updatedAt: 40, revision: 3 }],
        deleted: [],
        truncated: false,
        cursor: null,
        collectionVersion: 3,
      })
    },
  })
  assert.equal(page, 2)
  assert.equal(result.notes.length, 1)
  assert.equal(result.notes[0].content, 'latest')
  assert.equal(result.tombstones.length, 0)
  assert.equal(result.collectionVersion, 3)
})

test('sync request errors expose status and Retry-After for controller policy', async () => {
  await assert.rejects(
    syncWorkspace({
      endpoint: 'https://sync.example',
      fetchImpl: async () => response({ error: 'rate_limited' }, 429, { 'retry-after': '7' }),
    }),
    (error) => error.status === 429 && error.retryAfter === 7 && error.code === 'sync_fetch_429',
  )
})

test('a revision conflict keeps the local edit as a synced conflict copy and loads the server note', async () => {
  let putCount = 0
  const fetchImpl = async (url, options = {}) => {
    if (options.method !== 'PUT') {
      return response({ notes: [{ id: 'shared', title: 'Remote', content: 'old remote', updatedAt: 10, revision: 1 }], deleted: [] })
    }
    putCount += 1
    const body = JSON.parse(options.body)
    if (putCount === 1) {
      assert.equal(body.id, 'shared')
      return response({
        error: 'revision_conflict',
        note: { id: 'shared', title: 'Remote', content: 'new remote', updatedAt: 40, revision: 2 },
      }, 409)
    }
    assert.match(body.id, /^shared-conflict-/)
    assert.equal(body.content, 'local draft')
    assert.equal(options.headers['if-match'], undefined)
    return response({ ok: true, note: { ...body, revision: 1 }, collectionVersion: 3 }, 200, { 'x-notide-version': '3' })
  }

  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes: [{ id: 'shared', title: 'Local', content: 'local draft', updatedAt: 30, revision: 1 }],
    fetchImpl,
    now: () => 50,
  })

  assert.equal(result.notes.find((note) => note.id === 'shared').content, 'new remote')
  assert.equal(result.notes.find((note) => note.id !== 'shared').content, 'local draft')
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].noteId, 'shared')
  assert.equal(result.uploaded, 1)
  assert.equal(result.downloaded, 1)
})

test('a dirty local edit is not overwritten when the initial pull already contains a newer remote revision', async () => {
  let putCount = 0
  const fetchImpl = async (_url, options = {}) => {
    if (options.method !== 'PUT') {
      return response({ notes: [{ id: 'shared', title: 'Remote', content: 'new remote', updatedAt: 40, revision: 2 }], deleted: [] })
    }
    putCount += 1
    const body = JSON.parse(options.body)
    if (putCount === 1) {
      assert.equal(body.content, 'local draft')
      assert.equal(options.headers['if-match'], '"1"')
      return response({
        error: 'revision_conflict',
        note: { id: 'shared', title: 'Remote', content: 'new remote', updatedAt: 40, revision: 2 },
      }, 409)
    }
    assert.match(body.id, /^shared-conflict-/)
    assert.equal(body.content, 'local draft')
    return response({ ok: true, note: { ...body, revision: 1 }, collectionVersion: 3 }, 200)
  }

  const result = await syncWorkspace({
    endpoint: 'https://sync.example',
    notes: [{ id: 'shared', title: 'Local', content: 'local draft', updatedAt: 30, revision: 1 }],
    dirtyIds: ['shared'],
    collectionVersion: 1,
    fetchImpl,
    now: () => 50,
  })

  assert.equal(result.notes.find((note) => note.id === 'shared').content, 'new remote')
  assert.equal(result.notes.find((note) => note.id !== 'shared').content, 'local draft')
  assert.equal(result.conflicts.length, 1)
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
