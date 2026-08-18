import test from 'node:test'
import assert from 'node:assert/strict'
import { accountScope, clearSession, createUser, loadSession, login, persistSession, workspaceKeys } from '../src/auth.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('workspace keys isolate endpoint and principal', () => {
  const alice = workspaceKeys('https://notes.example.workers.dev', 'alice')
  const bob = workspaceKeys('https://notes.example.workers.dev/', 'bob')
  const other = workspaceKeys('https://other.example.workers.dev', 'alice')
  assert.notEqual(alice.notes, bob.notes)
  assert.notEqual(alice.notes, other.notes)
  assert.match(alice.notes, /^notide-workspace-v04:/)
  assert.match(accountScope('https://notes.example.workers.dev/api/notes', 'alice'), /alice$/)
})

test('sessions default to session storage and can be remembered explicitly', () => {
  const local = memoryStorage()
  const session = memoryStorage()
  const endpoint = 'https://notes.example.workers.dev'
  const value = { token: 'secret', user: { id: 'user-1', username: 'alice' }, expiresAt: '2999-01-01T00:00:00.000Z' }
  persistSession(endpoint, value, false, { local, session })
  assert.deepEqual(loadSession(endpoint, { local, session }), value)
  persistSession(endpoint, value, true, { local, session })
  assert.deepEqual(loadSession(endpoint, { local, session }), value)
  clearSession(endpoint, { local, session })
  assert.equal(loadSession(endpoint, { local, session }), null)
})

test('login and admin requests use JSON bearer contracts', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/api/auth/login')) return Response.json({ token: 'token', user: { id: 'super', role: 'super_admin' }, expiresAt: null })
    return Response.json({ user: { id: 'new-user' } })
  }
  const session = await login({ endpoint: 'https://notes.example.workers.dev', username: 'root', password: 'password', fetchImpl })
  await createUser({ endpoint: 'https://notes.example.workers.dev', token: session.token, user: { username: 'bob', password: 'password', role: 'user' }, fetchImpl })
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(JSON.parse(calls[0].options.body).username, 'root')
  assert.equal(calls[1].options.headers.authorization, 'Bearer token')
  assert.equal(calls[1].options.cache, 'no-store')
})
