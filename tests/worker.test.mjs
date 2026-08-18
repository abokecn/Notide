import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../workers/index.js'

class MemoryBucket {
  constructor() { this.items = new Map() }
  async get(key) {
    const value = this.items.get(key)
    if (!value) return null
    return { json: async () => JSON.parse(value), text: async () => value }
  }
  async put(key, value) { this.items.set(key, value) }
  async list({ prefix }) {
    return { objects: Array.from(this.items.keys()).filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }
  }
}

const env = () => ({ NOTES_BUCKET: new MemoryBucket(), SYNC_TOKEN: 'test-token' })
const request = (url, options = {}) => new Request(`https://sync.example${url}`, { ...options, headers: { authorization: 'Bearer test-token', ...(options.headers || {}) } })

test('worker stores, lists, reads, and protects notes', async () => {
  const testEnv = env()
  const put = await worker.fetch(request('/api/notes/a', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A', content: '# A', pinned: true, updatedAt: 10 }) }), testEnv)
  assert.equal(put.status, 200)
  const saved = (await put.json()).note
  assert.equal(saved.revision, 1)
  assert.equal(saved.pinned, true)

  const list = await worker.fetch(request('/api/notes'), testEnv)
  assert.equal((await list.json()).notes.length, 1)

  const get = await worker.fetch(request('/api/notes/a'), testEnv)
  assert.equal((await get.json()).note.title, 'A')

  const deleted = await worker.fetch(request('/api/notes/a', { method: 'DELETE' }), testEnv)
  assert.equal(deleted.status, 200)
  const afterDelete = await worker.fetch(request('/api/notes'), testEnv)
  assert.equal((await afterDelete.json()).deleted.length, 1)

  const unauthorized = await worker.fetch(new Request('https://sync.example/api/notes'), testEnv)
  assert.equal(unauthorized.status, 401)
})

test('worker rejects stale revisions', async () => {
  const testEnv = env()
  await worker.fetch(request('/api/notes/a', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'v1', updatedAt: 10 }) }), testEnv)
  const stale = await worker.fetch(request('/api/notes/a', { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"0"' }, body: JSON.stringify({ content: 'v2', updatedAt: 20 }) }), testEnv)
  assert.equal(stale.status, 409)
})

test('worker health check is authenticated and verifies the R2 binding', async () => {
  const healthy = await worker.fetch(request('/api/health'), env())
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), {
    ok: true,
    service: 'notide-sync',
    version: 1,
    storage: 'ready',
  })
  assert.equal(healthy.headers.get('cache-control'), 'no-store')
  assert.equal(healthy.headers.get('access-control-allow-origin'), '*')

  const unauthorized = await worker.fetch(new Request('https://sync.example/api/health'), env())
  assert.equal(unauthorized.status, 401)

  const unavailable = await worker.fetch(request('/api/health'), {
    SYNC_TOKEN: 'test-token',
    NOTES_BUCKET: { list: async () => { throw new Error('binding unavailable') } },
  })
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), { error: 'storage_unavailable' })

  const wrongMethod = await worker.fetch(request('/api/health', { method: 'POST' }), env())
  assert.equal(wrongMethod.status, 405)

  const preflight = await worker.fetch(new Request('https://sync.example/api/health', { method: 'OPTIONS' }), env())
  assert.equal(preflight.status, 200)
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/)
})
