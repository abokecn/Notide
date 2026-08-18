import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../workers/index.js'

const migration = fs.readFileSync(new URL('../migrations/0001_notide_v2.sql', import.meta.url), 'utf8')

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database
    this.sql = sql
    this.values = values
  }

  bind(...values) { return new D1Statement(this.database, this.sql, values) }

  first(column) {
    const row = this.database.sqlite.prepare(this.sql).get(...this.values) || null
    return column && row ? row[column] : row
  }

  all() {
    return { success: true, results: this.database.sqlite.prepare(this.sql).all(...this.values), meta: {} }
  }

  run() { return this.database.runStatement(this) }
}

class MemoryD1 {
  constructor(applyMigration = true) {
    this.sqlite = new DatabaseSync(':memory:')
    if (applyMigration) this.sqlite.exec(migration)
  }

  prepare(sql) { return new D1Statement(this, sql) }

  runStatement(statement) {
    const result = this.sqlite.prepare(statement.sql).run(...statement.values)
    return { success: true, results: [], meta: { changes: Number(result.changes || 0) } }
  }

  batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => this.runStatement(statement))
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  rows(sql, ...values) { return this.sqlite.prepare(sql).all(...values) }
  close() { this.sqlite.close() }
}

class MemoryBucket {
  constructor() {
    this.items = new Map()
    this.getCalls = 0
    this.listCalls = 0
    this.putCalls = 0
  }

  async get(key) {
    this.getCalls += 1
    const value = this.items.get(key)
    if (!value) return null
    return { json: async () => JSON.parse(value), text: async () => value }
  }

  async put(key, value, options = {}) {
    this.putCalls += 1
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.items.has(key)) return null
    this.items.set(key, value)
    return { key }
  }

  async list({ prefix }) {
    this.listCalls += 1
    return {
      objects: [...this.items.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    }
  }
}

function createEnv(overrides = {}) {
  return {
    DB: new MemoryD1(),
    NOTES_BUCKET: new MemoryBucket(),
    SUPER_ADMIN_USERNAME: 'root',
    SUPER_ADMIN_PASSWORD: 'correct horse battery staple',
    AUTH_PEPPER: 'pepper-for-tests-only',
    ...overrides,
  }
}

function request(path, options = {}, token = '') {
  return new Request(`https://sync.example${path}`, {
    ...options,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
}

async function login(env, username = 'root', password = env.SUPER_ADMIN_PASSWORD) {
  const response = await worker.fetch(request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ username, password }),
  }), env)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

async function createAccount(env, token, username, role = 'user', password = `${username}-password-strong`) {
  const response = await worker.fetch(request('/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: username.toUpperCase(), role, password }),
  }, token), env)
  assert.equal(response.status, 201, await response.clone().text())
  return { ...(await response.json()), password }
}

function noteBody(content, updatedAt, extra = {}) {
  return JSON.stringify({ title: content, content, updatedAt, ...extra })
}

test('Worker fails closed without D1 or all three super-admin secrets', async () => {
  const bucket = new MemoryBucket()
  const unconfigured = await worker.fetch(request('/api/health'), { NOTES_BUCKET: bucket })
  assert.equal(unconfigured.status, 503)
  assert.deepEqual(await unconfigured.json(), { error: 'service_not_configured' })
  assert.equal(unconfigured.headers.get('cache-control'), 'no-store')

  const missingPepper = createEnv({ AUTH_PEPPER: '' })
  const response = await worker.fetch(request('/api/auth/login', { method: 'POST', body: '{}' }), missingPepper)
  assert.equal(response.status, 503)
  missingPepper.DB.close()

  const preflight = await worker.fetch(request('/api/notes', { method: 'OPTIONS' }), {})
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-headers'), /if-none-match/)
  assert.equal(preflight.headers.get('cache-control'), 'no-store')

  const missingMigration = createEnv({ DB: new MemoryD1(false) })
  const migrationResponse = await worker.fetch(request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: missingMigration.SUPER_ADMIN_PASSWORD }),
  }), missingMigration)
  assert.equal(migrationResponse.status, 503)
  assert.equal((await migrationResponse.json()).error, 'database_unavailable')
  missingMigration.DB.close()
})

test('CORS defaults to public access and can be restricted to exact origins', async (context) => {
  const publicEnv = createEnv()
  const restrictedEnv = createEnv({ ALLOWED_ORIGINS: 'https://app.notide.example, https://admin.notide.example/' })
  context.after(() => {
    publicEnv.DB.close()
    restrictedEnv.DB.close()
  })

  const publicPreflight = await worker.fetch(request('/api/notes', {
    method: 'OPTIONS',
    headers: { origin: 'https://desktop.notide.example' },
  }), publicEnv)
  assert.equal(publicPreflight.status, 204)
  assert.equal(publicPreflight.headers.get('access-control-allow-origin'), '*')

  const allowedPreflight = await worker.fetch(request('/api/notes', {
    method: 'OPTIONS',
    headers: { origin: 'https://app.notide.example/' },
  }), restrictedEnv)
  assert.equal(allowedPreflight.status, 204)
  assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), 'https://app.notide.example')
  assert.match(allowedPreflight.headers.get('vary'), /Origin/i)

  const denied = await worker.fetch(request('/api/notes', {
    method: 'OPTIONS',
    headers: { origin: 'https://untrusted.example' },
  }), restrictedEnv)
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error, 'origin_forbidden')
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  assert.equal(denied.headers.get('cache-control'), 'no-store')
})

test('super admin login creates a hashed session, supports me/logout, and protects health', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const session = await login(env)
  assert.match(session.token, /^ntd_s_/)
  assert.equal(session.user.role, 'super_admin')
  assert.ok(Date.parse(session.expiresAt) > Date.now())

  const stored = env.DB.rows('SELECT token_hash FROM sessions')
  assert.equal(stored.length, 1)
  assert.notEqual(stored[0].token_hash, session.token)

  const me = await worker.fetch(request('/api/me', {}, session.token), env)
  assert.equal(me.status, 200)
  assert.equal((await me.json()).user.username, 'root')

  const healthy = await worker.fetch(request('/api/health', {}, session.token), env)
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), {
    ok: true,
    service: 'notide-sync',
    version: 2,
    storage: 'ready',
    database: 'ready',
  })
  assert.equal(healthy.headers.get('cache-control'), 'no-store')

  const wrongMethod = await worker.fetch(request('/api/health', { method: 'POST' }, session.token), env)
  assert.equal(wrongMethod.status, 405)

  const unauthorized = await worker.fetch(request('/api/health'), env)
  assert.equal(unauthorized.status, 401)
  const logout = await worker.fetch(request('/api/auth/logout', { method: 'POST' }, session.token), env)
  assert.equal(logout.status, 200)
  assert.equal((await worker.fetch(request('/api/me', {}, session.token), env)).status, 401)
})

test('super admin creates, updates, disables users while user RBAC blocks administration', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const created = await createAccount(env, root.token, 'alice')
  assert.equal(created.user.role, 'user')
  assert.equal('token' in created, false)
  assert.equal(JSON.stringify(env.DB.rows('SELECT * FROM users')).includes(created.password), false)

  const alice = await login(env, 'alice', created.password)
  assert.match(env.DB.rows('SELECT password_hash FROM users WHERE id = ?', created.user.id)[0].password_hash, /^pbkdf2-sha256:v1:/)
  const forbidden = await worker.fetch(request('/api/admin/users', {}, alice.token), env)
  assert.equal(forbidden.status, 403)

  const list = await worker.fetch(request('/api/admin/users', {}, root.token), env)
  const users = (await list.json()).users
  assert.equal(users.some((user) => user.role === 'super_admin'), true)
  assert.equal(users.some((user) => user.username === 'alice'), true)

  const resetPassword = 'alice-reset-password'
  const update = await worker.fetch(request(`/api/admin/users/${created.user.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'admin', password: resetPassword }),
  }, root.token), env)
  assert.equal(update.status, 200)
  assert.equal((await update.json()).passwordReset, true)
  assert.equal((await worker.fetch(request('/api/me', {}, alice.token), env)).status, 401)
  const promoted = await login(env, 'alice', resetPassword)
  assert.equal(promoted.user.role, 'admin')

  const disabled = await worker.fetch(request(`/api/admin/users/${created.user.id}`, { method: 'DELETE' }, root.token), env)
  assert.equal(disabled.status, 200)
  assert.equal((await disabled.json()).user.disabled, true)
  assert.equal((await worker.fetch(request('/api/me', {}, promoted.token), env)).status, 401)
  assert.equal(env.DB.rows("SELECT action FROM audit_log WHERE target_type = 'user'").length >= 3, true)
})

test('audit log is super-admin-only and paginates newest entries without overlap', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const adminAccount = await createAccount(env, root.token, 'auditor', 'admin')
  await createAccount(env, root.token, 'audit-user')
  const admin = await login(env, 'auditor', adminAccount.password)

  const forbidden = await worker.fetch(request('/api/admin/audit', {}, admin.token), env)
  assert.equal(forbidden.status, 403)

  const first = await worker.fetch(request('/api/admin/audit?limit=2', {}, root.token), env)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  const firstPayload = await first.json()
  assert.equal(firstPayload.entries.length, 2)
  assert.equal(firstPayload.truncated, true)
  assert.ok(firstPayload.cursor)
  assert.equal(firstPayload.entries.every((entry) => entry.action && !Number.isNaN(Date.parse(entry.createdAt))), true)

  const second = await worker.fetch(request(`/api/admin/audit?limit=2&cursor=${encodeURIComponent(firstPayload.cursor)}`, {}, root.token), env)
  assert.equal(second.status, 200)
  const secondPayload = await second.json()
  assert.equal(secondPayload.entries.length > 0, true)
  const firstIds = new Set(firstPayload.entries.map((entry) => entry.id))
  assert.equal(secondPayload.entries.some((entry) => firstIds.has(entry.id)), false)

  const invalidCursor = await worker.fetch(request('/api/admin/audit?cursor=not-base64', {}, root.token), env)
  assert.equal(invalidCursor.status, 400)
  assert.equal((await invalidCursor.json()).error, 'invalid_cursor')
  const invalidLimit = await worker.fetch(request('/api/admin/audit?limit=0', {}, root.token), env)
  assert.equal(invalidLimit.status, 400)
  assert.equal((await invalidLimit.json()).error, 'invalid_limit')
})

test('owner namespaces isolate same note ids and admin ownerId access is explicit', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const aliceAccount = await createAccount(env, root.token, 'alice')
  const bobAccount = await createAccount(env, root.token, 'bob')
  const adminAccount = await createAccount(env, root.token, 'editor', 'admin')
  const secondAdminAccount = await createAccount(env, root.token, 'reviewer', 'admin')
  const alice = await login(env, 'alice', aliceAccount.password)
  const bob = await login(env, 'bob', bobAccount.password)
  const admin = await login(env, 'editor', adminAccount.password)

  const alicePut = await worker.fetch(request('/api/notes/shared', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('Alice note', 10),
  }, alice.token), env)
  const bobPut = await worker.fetch(request('/api/notes/shared', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('Bob note', 11),
  }, bob.token), env)
  assert.equal(alicePut.status, 200)
  assert.equal(bobPut.status, 200)

  const aliceList = await worker.fetch(request('/api/notes', {}, alice.token), env)
  const bobList = await worker.fetch(request('/api/notes', {}, bob.token), env)
  assert.equal((await aliceList.json()).notes[0].content, 'Alice note')
  assert.equal((await bobList.json()).notes[0].content, 'Bob note')

  const forbidden = await worker.fetch(request(`/api/notes?ownerId=${bobAccount.user.id}`, {}, alice.token), env)
  assert.equal(forbidden.status, 403)
  const adminRead = await worker.fetch(request(`/api/notes?ownerId=${aliceAccount.user.id}`, {}, admin.token), env)
  assert.equal(adminRead.status, 200)
  assert.equal((await adminRead.json()).notes[0].content, 'Alice note')
  await worker.fetch(request(`/api/admin/users/${bobAccount.user.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled: true }),
  }, root.token), env)
  const disabledUserNotes = await worker.fetch(request(`/api/notes?ownerId=${bobAccount.user.id}`, {}, admin.token), env)
  assert.equal(disabledUserNotes.status, 200)
  assert.equal((await disabledUserNotes.json()).notes[0].content, 'Bob note')
  const adminUsers = await worker.fetch(request('/api/admin/users', {}, admin.token), env)
  assert.equal(adminUsers.status, 200)
  assert.deepEqual((await adminUsers.json()).users.map((user) => user.role), ['user', 'user'])
  const protectedSuperAdmin = await worker.fetch(request('/api/notes?ownerId=super-admin', {}, admin.token), env)
  assert.equal(protectedSuperAdmin.status, 403)
  const protectedAdmin = await worker.fetch(request(`/api/notes?ownerId=${secondAdminAccount.user.id}`, {}, admin.token), env)
  assert.equal(protectedAdmin.status, 403)

  const keys = [...env.NOTES_BUCKET.items.keys()]
  assert.equal(keys.some((key) => key.includes(encodeURIComponent(aliceAccount.user.id))), true)
  assert.equal(keys.some((key) => key.includes(encodeURIComponent(bobAccount.user.id))), true)
})

test('collection ETag returns 304 with zero R2 reads and delta pagination is stable', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  for (const [id, timestamp] of [['a', 10], ['b', 20]]) {
    const put = await worker.fetch(request(`/api/notes/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody(id, timestamp),
    }, root.token), env)
    assert.equal(put.status, 200)
  }

  const first = await worker.fetch(request('/api/notes?limit=1', {}, root.token), env)
  assert.equal(first.status, 200)
  const firstPayload = await first.json()
  assert.equal(firstPayload.notes.length, 1)
  assert.equal(firstPayload.truncated, true)
  assert.ok(firstPayload.cursor)
  const second = await worker.fetch(request(`/api/notes?limit=1&cursor=${encodeURIComponent(firstPayload.cursor)}`, {}, root.token), env)
  const secondPayload = await second.json()
  assert.equal(secondPayload.notes.length, 1)
  assert.notEqual(secondPayload.notes[0].id, firstPayload.notes[0].id)
  assert.equal(secondPayload.collectionVersion, firstPayload.collectionVersion)

  const full = await worker.fetch(request('/api/notes', {}, root.token), env)
  const etag = full.headers.get('etag')
  await full.arrayBuffer()
  const readsBefore = env.NOTES_BUCKET.getCalls
  const unchanged = await worker.fetch(request('/api/notes', { headers: { 'if-none-match': etag } }, root.token), env)
  assert.equal(unchanged.status, 304)
  assert.equal(env.NOTES_BUCKET.getCalls, readsBefore)
  assert.equal(unchanged.headers.get('cache-control'), 'no-store')

  const delta = await worker.fetch(request('/api/notes?since=1', {}, root.token), env)
  const deltaPayload = await delta.json()
  assert.deepEqual(deltaPayload.notes.map((note) => note.id), ['b'])
})

test('a pagination cursor catches a row that moves beyond its original snapshot and is owner-bound', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const aliceAccount = await createAccount(env, root.token, 'cursor-alice')
  for (const [id, timestamp] of [['a', 10], ['b', 20]]) {
    assert.equal((await worker.fetch(request(`/api/notes/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody(id, timestamp),
    }, root.token), env)).status, 200)
  }

  const first = await worker.fetch(request('/api/notes?limit=1', {}, root.token), env)
  const firstPayload = await first.json()
  assert.deepEqual(firstPayload.notes.map((note) => note.id), ['a'])

  const moved = await worker.fetch(request('/api/notes/b', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"1"' }, body: noteBody('b-new', 30),
  }, root.token), env)
  assert.equal(moved.status, 200)

  const second = await worker.fetch(request(`/api/notes?limit=1&cursor=${encodeURIComponent(firstPayload.cursor)}`, {}, root.token), env)
  const secondPayload = await second.json()
  assert.equal(secondPayload.notes.length, 0)
  assert.equal(secondPayload.truncated, true)
  assert.ok(secondPayload.cursor)
  const third = await worker.fetch(request(`/api/notes?limit=1&cursor=${encodeURIComponent(secondPayload.cursor)}`, {}, root.token), env)
  const thirdPayload = await third.json()
  assert.equal(thirdPayload.notes[0].content, 'b-new')
  assert.equal(thirdPayload.collectionVersion, 3)

  const wrongOwner = await worker.fetch(request(`/api/notes?ownerId=${aliceAccount.user.id}&cursor=${encodeURIComponent(firstPayload.cursor)}`, {}, root.token), env)
  assert.equal(wrongOwner.status, 400)
  assert.equal((await wrongOwner.json()).error, 'invalid_cursor')
})

test('revision CAS keeps immutable R2 versions and tombstone deltas', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const first = await worker.fetch(request('/api/notes/a', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('v1', 10),
  }, root.token), env)
  assert.equal(first.status, 200)
  assert.equal((await first.clone().json()).note.revision, 1)

  const second = await worker.fetch(request('/api/notes/a', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"1"' }, body: noteBody('v2', 20),
  }, root.token), env)
  assert.equal(second.status, 200)
  const secondPayload = await second.json()
  assert.equal(secondPayload.note.revision, 2)
  assert.equal(env.NOTES_BUCKET.items.size, 2)

  const stale = await worker.fetch(request('/api/notes/a', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"1"' }, body: noteBody('stale', 30),
  }, root.token), env)
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).note.content, 'v2')

  const removed = await worker.fetch(request('/api/notes/a', {
    method: 'DELETE', headers: { 'if-match': '"2"' },
  }, root.token), env)
  assert.equal(removed.status, 200)
  const removedPayload = await removed.json()
  assert.equal(removedPayload.revision, 3)
  assert.equal(env.NOTES_BUCKET.items.size, 3)

  const delta = await worker.fetch(request('/api/notes?since=2', {}, root.token), env)
  const deltaPayload = await delta.json()
  assert.equal(deltaPayload.notes.length, 0)
  assert.equal(deltaPayload.deleted[0].id, 'a')
  assert.equal(deltaPayload.collectionVersion, 3)
})

test('existing records require If-Match before a mutating PUT or DELETE', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  assert.equal((await worker.fetch(request('/api/notes/strict', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('base', 10),
  }, root.token), env)).status, 200)
  const putsBefore = env.NOTES_BUCKET.putCalls

  const blindPut = await worker.fetch(request('/api/notes/strict', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('blind', 20),
  }, root.token), env)
  assert.equal(blindPut.status, 409)
  assert.equal((await blindPut.json()).note.content, 'base')
  assert.equal(env.NOTES_BUCKET.putCalls, putsBefore)

  const blindDelete = await worker.fetch(request('/api/notes/strict', { method: 'DELETE' }, root.token), env)
  assert.equal(blindDelete.status, 409)
  assert.equal((await blindDelete.json()).note.content, 'base')
  assert.equal(env.NOTES_BUCKET.putCalls, putsBefore)
})

test('concurrent writes with the same revision allow exactly one D1 CAS winner', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  await worker.fetch(request('/api/notes/race', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('base', 10),
  }, root.token), env)

  const options = (content, updatedAt) => ({
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': '"1"' },
    body: noteBody(content, updatedAt),
  })
  const responses = await Promise.all([
    worker.fetch(request('/api/notes/race', options('left', 20), root.token), env),
    worker.fetch(request('/api/notes/race', options('right', 21), root.token), env),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  const index = env.DB.rows("SELECT revision, change_version FROM note_index WHERE note_id = 'race'")[0]
  assert.equal(index.revision, 2)
  assert.equal(index.change_version, 2)
  assert.ok(env.NOTES_BUCKET.items.size >= 2)
})

test('note and request byte limits reject oversized input', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const noteTooLarge = await worker.fetch(request('/api/notes/large', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Large', content: 'x'.repeat(1024 * 1024), updatedAt: 10 }),
  }, root.token), env)
  assert.equal(noteTooLarge.status, 413)
  assert.equal((await noteTooLarge.json()).error, 'note_too_large')

  const requestTooLarge = await worker.fetch(request('/api/notes/huge', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: `{"content":"${'x'.repeat(2 * 1024 * 1024)}"}`,
  }, root.token), env)
  assert.equal(requestTooLarge.status, 413)
  assert.equal((await requestTooLarge.json()).error, 'payload_too_large')
})

test('note timestamps too far in the future are rejected', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  const response = await worker.fetch(request('/api/notes/future', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: noteBody('future', Date.now() + (6 * 60_000)),
  }, root.token), env)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'invalid_updated_at')
  assert.equal(env.NOTES_BUCKET.putCalls, 0)
})

test('login rate limit returns 429, Retry-After, and no-store', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  let last
  for (let attempt = 0; attempt < 11; attempt += 1) {
    last = await worker.fetch(request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.9' },
      body: JSON.stringify({ username: 'root', password: 'wrong-password-value' }),
    }), env)
  }
  assert.equal(last.status, 429)
  assert.ok(Number(last.headers.get('retry-after')) >= 1)
  assert.equal(last.headers.get('cache-control'), 'no-store')
})

test('unknown usernames share one account limiter key and oversized credentials are rejected', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  for (const username of ['missing-one', 'missing-two']) {
    const result = await worker.fetch(request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.44' },
      body: JSON.stringify({ username, password: 'wrong-password-value' }),
    }), env)
    assert.equal(result.status, 401)
  }
  assert.equal(env.DB.rows("SELECT rate_key FROM rate WHERE rate_key LIKE 'login-account:%'").length, 1)
  const oversized = await worker.fetch(request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.45' },
    body: JSON.stringify({ username: 'x'.repeat(33), password: 'wrong-password-value' }),
  }), env)
  assert.equal(oversized.status, 401)
})

test('authenticated API rate limit applies to read requests per account', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  let response
  for (let attempt = 0; attempt < 121; attempt += 1) {
    response = await worker.fetch(request('/api/me', {}, root.token), env)
  }
  assert.equal(response.status, 429)
  assert.equal((await response.json()).error, 'rate_limited')
  assert.ok(Number(response.headers.get('retry-after')) >= 1)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const logout = await worker.fetch(request('/api/auth/logout', { method: 'POST' }, root.token), env)
  assert.equal(logout.status, 200)
})

test('missing indexed R2 object returns storage_inconsistent', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  const root = await login(env)
  await worker.fetch(request('/api/notes/a', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: noteBody('A', 10),
  }, root.token), env)
  env.NOTES_BUCKET.items.clear()
  const response = await worker.fetch(request('/api/notes', {}, root.token), env)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'storage_inconsistent')
})

test('super-admin legacy R2 migration is idempotent and keeps source objects', async (context) => {
  const env = createEnv()
  context.after(() => env.DB.close())
  env.NOTES_BUCKET.items.set('notes/legacy.json', JSON.stringify({
    id: 'legacy',
    title: 'Legacy',
    content: '# Legacy',
    folder: 'Imported',
    pinned: true,
    updatedAt: 42,
    revision: 3,
  }))
  const root = await login(env)
  const ownerRequired = await worker.fetch(request('/api/admin/migrations/legacy-r2', { method: 'POST' }, root.token), env)
  assert.equal(ownerRequired.status, 400)
  assert.equal((await ownerRequired.json()).error, 'owner_required')
  const migrated = await worker.fetch(request('/api/admin/migrations/legacy-r2?ownerId=super-admin', { method: 'POST' }, root.token), env)
  assert.equal(migrated.status, 200)
  assert.equal((await migrated.json()).migrated, 1)
  assert.equal(env.NOTES_BUCKET.items.has('notes/legacy.json'), true)

  const list = await worker.fetch(request('/api/notes', {}, root.token), env)
  const payload = await list.json()
  assert.equal(payload.notes[0].id, 'legacy')
  assert.equal(payload.notes[0].revision, 3)

  const repeated = await worker.fetch(request('/api/admin/migrations/legacy-r2?ownerId=super-admin', { method: 'POST' }, root.token), env)
  const repeatedPayload = await repeated.json()
  assert.equal(repeatedPayload.migrated, 0)
  assert.equal(repeatedPayload.skipped, 1)
})
