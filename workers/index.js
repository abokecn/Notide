const API_VERSION = 2
const NOTE_MAX_BYTES = 1024 * 1024
const REQUEST_MAX_BYTES = 2 * 1024 * 1024
const JSON_MAX_BYTES = 64 * 1024
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 200
const MAX_PAGE_BYTES = (2 * 1024 * 1024) - (64 * 1024)
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PASSWORD_ITERATIONS = 120_000
const PASSWORD_VERSION = 1
const PASSWORD_HASH_PREFIX = `pbkdf2-sha256:v${PASSWORD_VERSION}:`
const DUMMY_PASSWORD_SALT = 'Tm90aWRlLWR1bW15LXNhbHQ'
const LOGIN_RATE_LIMIT = 10
const API_RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000
const MAX_CLOCK_SKEW_MS = 5 * 60_000

const encoder = new TextEncoder()

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, if-match, if-none-match',
  'access-control-expose-headers': 'etag, retry-after, x-notide-version',
}

class HttpError extends Error {
  constructor(status, code, details = {}) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

function responseHeaders(headers = {}) {
  return { ...corsHeaders, 'cache-control': 'no-store', ...headers }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders({ ...headers, 'content-type': 'application/json; charset=utf-8' }),
  })
}

function empty(status, headers = {}) {
  return new Response(null, { status, headers: responseHeaders(headers) })
}

function allowedOrigins(env) {
  const configuredValue = String(env?.ALLOWED_ORIGINS || '').trim()
  if (!configuredValue) return ['*']
  return configuredValue.split(/[\s,]+/).map((value) => value.trim().replace(/\/$/, '')).filter(Boolean)
}

function originAllowed(request, env) {
  const origin = request.headers.get('origin')?.replace(/\/$/, '') || ''
  const allowed = allowedOrigins(env)
  return !origin || allowed.includes('*') || allowed.includes(origin)
}

function applyCors(response, request, env) {
  const headers = new Headers(response.headers)
  headers.delete('access-control-allow-origin')
  const origin = request.headers.get('origin')?.replace(/\/$/, '') || ''
  const allowed = allowedOrigins(env)
  if (allowed.includes('*')) {
    headers.set('access-control-allow-origin', '*')
  } else if (origin && allowed.includes(origin)) {
    headers.set('access-control-allow-origin', origin)
    headers.append('vary', 'Origin')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function configured(env) {
  return Boolean(
    env?.DB?.prepare
    && env?.NOTES_BUCKET?.get
    && env?.NOTES_BUCKET?.put
    && String(env?.SUPER_ADMIN_USERNAME || '').trim()
    && String(env?.SUPER_ADMIN_PASSWORD || '')
    && String(env?.AUTH_PEPPER || ''),
  )
}

function now() {
  return Date.now()
}

function randomBytes(size) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomToken(prefix, size = 32) {
  return `${prefix}${base64Url(randomBytes(size))}`
}

function randomId(prefix) {
  const uuid = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : base64Url(randomBytes(18))
  return `${prefix}${uuid}`
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64Url(new Uint8Array(digest))
}

async function sessionHash(token, pepper) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`notide-session\u0000${token}`))
  return base64Url(new Uint8Array(signature))
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ''))
  const b = encoder.encode(String(right || ''))
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0)
  return difference === 0
}

async function derivePassword(password, salt, pepper) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${password}\u0000${pepper}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decodeBase64Url(salt), iterations: PASSWORD_ITERATIONS },
    material,
    256,
  )
  return base64Url(new Uint8Array(bits))
}

function encodePasswordHash(hash) {
  return `${PASSWORD_HASH_PREFIX}${hash}`
}

function decodePasswordHash(value) {
  const stored = String(value || '')
  if (stored.startsWith(PASSWORD_HASH_PREFIX)) return stored.slice(PASSWORD_HASH_PREFIX.length)
  // Passwords created by the first v2 preview used the same PBKDF2 profile
  // without an envelope. Accept them so upgrades do not lock users out.
  if (/^[A-Za-z0-9_-]{43}$/.test(stored)) return stored
  return ''
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.displayName ?? row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
    createdAt: Number(row.created_at ?? row.createdAt ?? 0),
    updatedAt: Number(row.updated_at ?? row.updatedAt ?? 0),
  }
}

function superAdminUser(env) {
  return {
    id: 'super-admin',
    username: String(env.SUPER_ADMIN_USERNAME).trim(),
    displayName: String(env.SUPER_ADMIN_USERNAME).trim(),
    role: 'super_admin',
    disabled: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

async function readRequestText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large')

  if (!request.body?.getReader) {
    const text = await request.text()
    if (encoder.encode(text).byteLength > maxBytes) throw new HttpError(413, 'payload_too_large')
    return text
  }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, 'payload_too_large')
    }
    chunks.push(decoder.decode(value, { stream: true }))
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}

async function parseJson(request, maxBytes = JSON_MAX_BYTES) {
  const text = await readRequestText(request, maxBytes)
  try {
    return JSON.parse(text || '{}')
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

function bearerToken(request) {
  const value = request.headers.get('authorization') || ''
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function clientAddress(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

async function enforceRateLimit(db, key, limit) {
  const timestamp = now()
  const cutoff = timestamp - RATE_WINDOW_MS
  const row = await db.prepare(`
    INSERT INTO rate (rate_key, window_start, request_count, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(rate_key) DO UPDATE SET
      window_start = CASE WHEN rate.window_start < ? THEN excluded.window_start ELSE rate.window_start END,
      request_count = CASE WHEN rate.window_start < ? THEN 1 ELSE rate.request_count + 1 END,
      updated_at = excluded.updated_at
    RETURNING window_start, request_count
  `).bind(key, timestamp, timestamp, cutoff, cutoff).first()

  if (Number(row?.request_count || 0) <= limit) return
  const retryAfter = Math.max(1, Math.ceil((Number(row.window_start) + RATE_WINDOW_MS - timestamp) / 1000))
  throw new HttpError(429, 'rate_limited', { retryAfter })
}

async function findUserByUsername(db, username) {
  return db.prepare(`
    SELECT id, username, display_name, role, password_hash, password_salt, disabled, created_at, updated_at
    FROM users WHERE username = ? COLLATE NOCASE
  `).bind(username).first()
}

async function authenticateCredentials(username, password, env, knownUser = undefined) {
  const normalized = String(username || '').trim()
  const secretPassword = String(password || '')
  if (!normalized || !secretPassword) throw new HttpError(400, 'credentials_required')
  if (normalized.length > 32 || secretPassword.length > 128) throw new HttpError(401, 'invalid_credentials')

  const superUsernameMatches = normalized.toLowerCase() === String(env.SUPER_ADMIN_USERNAME).trim().toLowerCase()
  if (superUsernameMatches) {
    const salt = await sha256(`notide-super-admin:v${PASSWORD_VERSION}\u0000${normalized.toLowerCase()}\u0000${env.AUTH_PEPPER}`)
    const [actual, expected] = await Promise.all([
      derivePassword(secretPassword, salt, env.AUTH_PEPPER),
      derivePassword(String(env.SUPER_ADMIN_PASSWORD), salt, env.AUTH_PEPPER),
    ])
    if (constantTimeEqual(actual, expected)) return superAdminUser(env)
  }

  const row = knownUser === undefined ? await findUserByUsername(env.DB, normalized) : knownUser
  if (!row || row.disabled) {
    await derivePassword(secretPassword, DUMMY_PASSWORD_SALT, env.AUTH_PEPPER)
    throw new HttpError(401, 'invalid_credentials')
  }
  const expectedHash = decodePasswordHash(row.password_hash)
  if (!expectedHash) throw new HttpError(401, 'invalid_credentials')
  const derived = await derivePassword(secretPassword, row.password_salt, env.AUTH_PEPPER)
  if (!constantTimeEqual(derived, expectedHash)) throw new HttpError(401, 'invalid_credentials')
  return publicUser(row)
}

async function authenticateRequest(request, env) {
  const token = bearerToken(request)
  if (!token) throw new HttpError(401, 'unauthorized')
  const tokenHash = await sessionHash(token, env.AUTH_PEPPER)
  const timestamp = now()
  const row = await env.DB.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id AS session_user_id,
      s.role AS session_role,
      s.expires_at,
      s.last_seen_at,
      u.id,
      u.username,
      u.display_name,
      u.role,
      u.disabled,
      u.created_at,
      u.updated_at
    FROM sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
  `).bind(tokenHash, timestamp).first()

  if (!row) throw new HttpError(401, 'unauthorized')
  if (row.session_role === 'super_admin') {
    return { user: superAdminUser(env), sessionId: row.session_id, lastSeenAt: Number(row.last_seen_at || 0) }
  }
  if (!row.id || row.disabled) throw new HttpError(401, 'account_disabled')
  return { user: publicUser(row), sessionId: row.session_id, lastSeenAt: Number(row.last_seen_at || 0) }
}

async function audit(db, actorId, action, targetType, targetId, status = 'ok', metadata = null) {
  try {
    await db.prepare(`
      INSERT INTO audit_log (actor_id, action, target_type, target_id, status, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(actorId, action, targetType, targetId || null, status, now(), metadata ? JSON.stringify(metadata) : null).run()
  } catch {
    // Audit failures do not roll back a completed note or account mutation.
  }
}

function decodeAuditCursor(value) {
  if (!value) return null
  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(value))
    const cursor = JSON.parse(decoded)
    if (!Number.isInteger(cursor.createdAt) || cursor.createdAt < 0 || !Number.isInteger(cursor.id) || cursor.id < 1) {
      throw new Error('invalid')
    }
    return cursor
  } catch {
    throw new HttpError(400, 'invalid_cursor')
  }
}

function auditPageSize(url) {
  const parsed = Number(url.searchParams.get('limit') || 50)
  if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, 'invalid_limit')
  return Math.min(parsed, 100)
}

function publicAuditEntry(row) {
  let metadata = null
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata)
    } catch {
      metadata = null
    }
  }
  return {
    id: Number(row.id),
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id || null,
    status: row.status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    metadata,
  }
}

async function listAuditLog(url, env) {
  const cursor = decodeAuditCursor(url.searchParams.get('cursor'))
  const limit = auditPageSize(url)
  const result = cursor
    ? await env.DB.prepare(`
      SELECT id, actor_id, action, target_type, target_id, status, created_at, metadata
      FROM audit_log
      WHERE created_at < ? OR (created_at = ? AND id < ?)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1).all()
    : await env.DB.prepare(`
      SELECT id, actor_id, action, target_type, target_id, status, created_at, metadata
      FROM audit_log
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(limit + 1).all()
  const rows = result.results || []
  const selected = rows.slice(0, limit)
  const truncated = rows.length > limit
  const last = selected.at(-1)
  const nextCursor = truncated && last
    ? base64Url(encoder.encode(JSON.stringify({ createdAt: Number(last.created_at), id: Number(last.id) })))
    : null
  return json({ entries: selected.map(publicAuditEntry), cursor: nextCursor, truncated })
}

async function handleLogin(request, env) {
  await enforceRateLimit(env.DB, `login:${clientAddress(request)}`, LOGIN_RATE_LIMIT)
  const body = await parseJson(request)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) throw new HttpError(400, 'credentials_required')
  if (username.length > 32 || password.length > 128) throw new HttpError(401, 'invalid_credentials')
  const superAdmin = username.toLowerCase() === String(env.SUPER_ADMIN_USERNAME).trim().toLowerCase()
  const knownUser = superAdmin ? null : await findUserByUsername(env.DB, username)
  const accountIdentity = superAdmin ? 'super-admin' : (knownUser ? `user:${knownUser.id}` : 'unknown')
  const accountKey = await sha256(`${env.AUTH_PEPPER}\u0000${accountIdentity}`)
  await enforceRateLimit(env.DB, `login-account:${accountKey}`, LOGIN_RATE_LIMIT)
  let user
  try {
    user = await authenticateCredentials(username, password, env, knownUser)
  } catch (error) {
    await audit(env.DB, 'anonymous', 'auth.login', 'account', username || null, 'denied')
    throw error
  }
  const token = randomToken('ntd_s_')
  const tokenHash = await sessionHash(token, env.AUTH_PEPPER)
  const timestamp = now()
  const expiresAt = timestamp + SESSION_TTL_MS
  const sessionId = randomId('ses_')
  await env.DB.prepare(`
    INSERT INTO sessions (id, token_hash, user_id, role, expires_at, created_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(sessionId, tokenHash, user.id, user.role, expiresAt, timestamp, timestamp).run()
  await audit(env.DB, user.id, 'auth.login', 'session', sessionId)
  return json({ token, user, expiresAt: new Date(expiresAt).toISOString() })
}

async function handleLogout(auth, env) {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now(), auth.sessionId).run()
  await audit(env.DB, auth.user.id, 'auth.logout', 'session', auth.sessionId)
  return json({ ok: true })
}

function validateUsername(value) {
  const username = String(value || '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) throw new HttpError(400, 'invalid_username')
  return username
}

function validateDisplayName(value, fallback) {
  const displayName = String(value || fallback || '').trim()
  if (!displayName || displayName.length > 80) throw new HttpError(400, 'invalid_display_name')
  return displayName
}

function validateRole(value) {
  if (!['admin', 'user'].includes(value)) throw new HttpError(400, 'invalid_role')
  return value
}

function validatePassword(value) {
  const password = String(value || '')
  if (password.length < 12 || password.length > 128) throw new HttpError(400, 'invalid_password')
  return password
}

async function listUsers(auth, env) {
  const onlyRegularUsers = auth.user.role === 'admin'
  const result = await env.DB.prepare(`
    SELECT id, username, display_name, role, disabled, created_at, updated_at
    FROM users
    WHERE (? = 0 OR role = 'user')
    ORDER BY disabled ASC, username COLLATE NOCASE ASC
  `).bind(onlyRegularUsers ? 1 : 0).all()
  const users = (result.results || []).map(publicUser)
  return json({ users: onlyRegularUsers ? users : [superAdminUser(env), ...users] })
}

async function createUser(request, auth, env) {
  const body = await parseJson(request)
  const username = validateUsername(body.username)
  if (username.toLowerCase() === String(env.SUPER_ADMIN_USERNAME).trim().toLowerCase()) throw new HttpError(409, 'username_exists')
  if (await findUserByUsername(env.DB, username)) throw new HttpError(409, 'username_exists')
  const displayName = validateDisplayName(body.displayName, username)
  const role = validateRole(body.role)
  const temporaryPassword = body.password ? null : randomToken('', 18)
  const password = validatePassword(body.password || temporaryPassword)
  const salt = base64Url(randomBytes(16))
  const passwordHash = encodePasswordHash(await derivePassword(password, salt, env.AUTH_PEPPER))
  const timestamp = now()
  const id = randomId('usr_')
  await env.DB.prepare(`
    INSERT INTO users (id, username, display_name, role, password_hash, password_salt, disabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(id, username, displayName, role, passwordHash, salt, timestamp, timestamp).run()
  const user = { id, username, displayName, role, disabled: false, createdAt: timestamp, updatedAt: timestamp }
  await audit(env.DB, auth.user.id, 'user.create', 'user', id, 'ok', { role })
  return json({ user, ...(temporaryPassword ? { temporaryPassword } : {}) }, 201)
}

async function getUserOrThrow(env, id) {
  const row = await env.DB.prepare(`
    SELECT id, username, display_name, role, disabled, created_at, updated_at
    FROM users WHERE id = ?
  `).bind(id).first()
  if (!row) throw new HttpError(404, 'user_not_found')
  return row
}

async function updateUser(request, auth, env, id) {
  const existing = await getUserOrThrow(env, id)
  const body = await parseJson(request)
  const username = body.username == null ? existing.username : validateUsername(body.username)
  if (username.toLowerCase() === String(env.SUPER_ADMIN_USERNAME).trim().toLowerCase()) throw new HttpError(409, 'username_exists')
  const duplicate = await findUserByUsername(env.DB, username)
  if (duplicate && duplicate.id !== id) throw new HttpError(409, 'username_exists')
  const displayName = body.displayName == null ? existing.display_name : validateDisplayName(body.displayName, username)
  const role = body.role == null ? existing.role : validateRole(body.role)
  const disabled = body.disabled == null ? Number(existing.disabled) : (body.disabled ? 1 : 0)
  const timestamp = now()
  let passwordHash = null
  let passwordSalt = null
  if (body.password != null) {
    const password = validatePassword(body.password)
    passwordSalt = base64Url(randomBytes(16))
    passwordHash = encodePasswordHash(await derivePassword(password, passwordSalt, env.AUTH_PEPPER))
  }
  await env.DB.prepare(`
    UPDATE users SET
      username = ?, display_name = ?, role = ?, disabled = ?, updated_at = ?,
      password_hash = COALESCE(?, password_hash), password_salt = COALESCE(?, password_salt)
    WHERE id = ?
  `).bind(username, displayName, role, disabled, timestamp, passwordHash, passwordSalt, id).run()
  if (disabled || passwordHash || role !== existing.role) {
    await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(timestamp, id).run()
  }
  const user = { id, username, displayName, role, disabled: Boolean(disabled), createdAt: Number(existing.created_at), updatedAt: timestamp }
  await audit(env.DB, auth.user.id, 'user.update', 'user', id, 'ok', { role, disabled: Boolean(disabled), passwordReset: Boolean(passwordHash) })
  return json({ user, ...(passwordHash ? { passwordReset: true } : {}) })
}

async function deleteUser(auth, env, id) {
  const existing = await getUserOrThrow(env, id)
  const timestamp = now()
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET disabled = 1, updated_at = ? WHERE id = ?').bind(timestamp, id),
    env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(timestamp, id),
  ])
  const user = { ...publicUser(existing), disabled: true, updatedAt: timestamp }
  await audit(env.DB, auth.user.id, 'user.disable', 'user', id)
  return json({ ok: true, user })
}

function requireSuperAdmin(auth) {
  if (auth.user.role !== 'super_admin') throw new HttpError(403, 'forbidden')
}

function requireAdmin(auth) {
  if (!['super_admin', 'admin'].includes(auth.user.role)) throw new HttpError(403, 'forbidden')
}

async function resolveOwner(auth, url, env) {
  const requested = String(url.searchParams.get('ownerId') || '').trim()
  if (!requested || requested === auth.user.id) return auth.user.id
  requireAdmin(auth)
  if (requested === 'super-admin') {
    if (auth.user.role !== 'super_admin') throw new HttpError(403, 'forbidden')
    return requested
  }
  const owner = await env.DB.prepare('SELECT id, role, disabled FROM users WHERE id = ?').bind(requested).first()
  if (!owner) throw new HttpError(404, 'owner_not_found')
  if (auth.user.role === 'admin' && owner.role !== 'user') throw new HttpError(403, 'forbidden')
  return requested
}

function noteObjectKey(ownerId, noteId, revision) {
  return `v2/users/${encodeURIComponent(ownerId)}/notes/${encodeURIComponent(noteId)}/r${revision}-${base64Url(randomBytes(8))}.json`
}

async function readObject(bucket, key) {
  const object = await bucket.get(key)
  if (!object) return null
  return object.json ? object.json() : JSON.parse(await object.text())
}

function parseExpectedRevision(request) {
  const value = request.headers.get('if-match')
  if (!value) return null
  const normalized = value.replace(/^W\//, '').replaceAll('"', '').trim()
  if (!/^\d+$/.test(normalized)) throw new HttpError(400, 'invalid_if_match')
  return Number(normalized)
}

function validNote(body, id, ownerId) {
  if (!body || typeof body.content !== 'string') throw new HttpError(400, 'invalid_note')
  const suppliedUpdatedAt = body.updatedAt == null ? now() : body.updatedAt
  if (!Number.isFinite(suppliedUpdatedAt) || suppliedUpdatedAt < 0 || suppliedUpdatedAt > now() + MAX_CLOCK_SKEW_MS) {
    throw new HttpError(400, 'invalid_updated_at')
  }
  const note = {
    id,
    ownerId,
    title: String(body.title || 'Untitled note').slice(0, 240),
    content: body.content,
    folder: String(body.folder || 'Unsorted').slice(0, 120),
    favorite: Boolean(body.favorite),
    pinned: Boolean(body.pinned),
    archived: Boolean(body.archived),
    updatedAt: Number(suppliedUpdatedAt),
  }
  const size = encoder.encode(JSON.stringify(note)).byteLength
  if (size > NOTE_MAX_BYTES) throw new HttpError(413, 'note_too_large')
  return note
}

async function ensureCollection(db, ownerId) {
  await db.prepare(`
    INSERT INTO collection_versions (owner_id, version, updated_at)
    VALUES (?, 0, ?)
    ON CONFLICT(owner_id) DO NOTHING
  `).bind(ownerId, now()).run()
}

async function collectionVersion(db, ownerId) {
  await ensureCollection(db, ownerId)
  const row = await db.prepare('SELECT version FROM collection_versions WHERE owner_id = ?').bind(ownerId).first()
  return Number(row?.version || 0)
}

function ownerHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function collectionEtag(ownerId, version) {
  return `"notide-${ownerHash(ownerId)}-${version}"`
}

function encodeCursor(cursor) {
  return base64Url(encoder.encode(JSON.stringify(cursor)))
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(value))
    const cursor = JSON.parse(decoded)
    if (
      !Number.isInteger(cursor.changeVersion)
      || cursor.changeVersion < 0
      || typeof cursor.noteId !== 'string'
      || cursor.noteId.length > 180
      || !Number.isInteger(cursor.targetVersion)
      || cursor.targetVersion < cursor.changeVersion
      || typeof cursor.ownerId !== 'string'
      || !cursor.ownerId
    ) throw new Error('invalid')
    return cursor
  } catch {
    throw new HttpError(400, 'invalid_cursor')
  }
}

function pageSize(url) {
  const parsed = Number(url.searchParams.get('limit') || DEFAULT_PAGE_SIZE)
  if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, 'invalid_limit')
  return Math.min(parsed, MAX_PAGE_SIZE)
}

async function readIndexedNote(env, row) {
  const note = await readObject(env.NOTES_BUCKET, row.object_key)
  if (!note) throw new HttpError(503, 'storage_inconsistent')
  return note
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function listNotes(request, auth, url, env) {
  const ownerId = await resolveOwner(auth, url, env)
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  const sinceValue = url.searchParams.get('since')
  if (cursor && cursor.ownerId !== ownerId) throw new HttpError(400, 'invalid_cursor')
  if (cursor && sinceValue != null && sinceValue !== '') throw new HttpError(400, 'invalid_cursor')
  const since = sinceValue == null || sinceValue === '' ? null : Number(sinceValue)
  if (since != null && (!Number.isInteger(since) || since < 0)) throw new HttpError(400, 'invalid_since')
  const currentVersion = await collectionVersion(env.DB, ownerId)
  const targetVersion = cursor?.targetVersion ?? currentVersion
  if (targetVersion > currentVersion || (since != null && since > currentVersion)) {
    throw new HttpError(409, 'sync_version_ahead', { version: currentVersion })
  }
  const etag = collectionEtag(ownerId, targetVersion)
  if (!cursor && since == null && request.headers.get('if-none-match') === etag) {
    return empty(304, { etag, 'x-notide-version': String(currentVersion) })
  }

  const limit = pageSize(url)
  const afterVersion = cursor?.changeVersion ?? -1
  const afterId = cursor?.noteId ?? ''
  const minimumVersion = since ?? -1
  const result = await env.DB.prepare(`
    SELECT owner_id, note_id, object_key, revision, updated_at, deleted_at, change_version, byte_size
    FROM note_index
    WHERE owner_id = ?
      AND change_version > ?
      AND change_version <= ?
      AND (change_version > ? OR (change_version = ? AND note_id > ?))
    ORDER BY change_version ASC, note_id ASC
    LIMIT ?
  `).bind(ownerId, minimumVersion, targetVersion, afterVersion, afterVersion, afterId, limit + 1).all()
  const rows = result.results || []
  const selected = []
  let selectedBytes = 0
  for (const row of rows.slice(0, limit)) {
    const rowBytes = Math.max(0, Number(row.byte_size || 0))
    if (selected.length && selectedBytes + rowBytes > MAX_PAGE_BYTES) break
    selected.push(row)
    selectedBytes += rowBytes
  }
  const objects = await mapWithConcurrency(selected, 8, (row) => readIndexedNote(env, row))
  const notes = []
  const deleted = []
  for (const note of objects) {
    if (note.deletedAt) deleted.push(note)
    else notes.push(note)
  }
  let truncated = selected.length < rows.length
  const last = selected.at(-1)
  let nextCursor = truncated && last
    ? encodeCursor({ ownerId, changeVersion: Number(last.change_version), noteId: last.note_id, targetVersion })
    : null
  if (!truncated) {
    // note_index keeps only the latest pointer. If an unvisited row moved past
    // this page's snapshot while pagination was in progress, extend the cursor
    // so the caller receives that newer record instead of silently skipping it.
    const latestVersion = await collectionVersion(env.DB, ownerId)
    if (latestVersion > targetVersion) {
      truncated = true
      nextCursor = encodeCursor({ ownerId, changeVersion: targetVersion, noteId: '', targetVersion: latestVersion })
    }
  }
  return json(
    { notes, deleted, truncated, cursor: nextCursor, version: targetVersion, collectionVersion: targetVersion },
    200,
    { etag, 'x-notide-version': String(targetVersion) },
  )
}

async function getIndexRow(db, ownerId, noteId) {
  return db.prepare(`
    SELECT owner_id, note_id, object_key, revision, updated_at, deleted_at, change_version, byte_size
    FROM note_index WHERE owner_id = ? AND note_id = ?
  `).bind(ownerId, noteId).first()
}

async function getNote(auth, url, env, noteId) {
  const ownerId = await resolveOwner(auth, url, env)
  const row = await getIndexRow(env.DB, ownerId, noteId)
  if (!row || row.deleted_at) throw new HttpError(404, 'note_not_found')
  const note = await readIndexedNote(env, row)
  return json({ note }, 200, { etag: `"${row.revision}"` })
}

function noteCasStatement(db, current, record) {
  if (current) {
    return db.prepare(`
      UPDATE note_index SET
        object_key = ?, revision = ?, updated_at = ?, deleted_at = ?, byte_size = ?,
        change_version = (SELECT version + 1 FROM collection_versions WHERE owner_id = ?)
      WHERE owner_id = ? AND note_id = ? AND revision = ?
    `).bind(
      record.objectKey,
      record.revision,
      record.updatedAt,
      record.deletedAt,
      record.byteSize,
      record.ownerId,
      record.ownerId,
      record.noteId,
      Number(current.revision),
    )
  }
  return db.prepare(`
    INSERT OR IGNORE INTO note_index
      (owner_id, note_id, object_key, revision, updated_at, deleted_at, change_version, byte_size)
    SELECT ?, ?, ?, ?, ?, ?, version + 1, ?
    FROM collection_versions WHERE owner_id = ?
  `).bind(
    record.ownerId,
    record.noteId,
    record.objectKey,
    record.revision,
    record.updatedAt,
    record.deletedAt,
    record.byteSize,
    record.ownerId,
  )
}

function collectionCasStatement(db, record) {
  return db.prepare(`
    UPDATE collection_versions SET version = version + 1, updated_at = ?
    WHERE owner_id = ? AND EXISTS (
      SELECT 1 FROM note_index
      WHERE owner_id = ? AND note_id = ? AND object_key = ?
        AND change_version = collection_versions.version + 1
    )
  `).bind(now(), record.ownerId, record.ownerId, record.noteId, record.objectKey)
}

async function commitRecord(env, current, record) {
  await ensureCollection(env.DB, record.ownerId)
  const results = await env.DB.batch([
    noteCasStatement(env.DB, current, record),
    collectionCasStatement(env.DB, record),
  ])
  const noteChanged = Number(results?.[0]?.meta?.changes || 0) > 0
  const versionChanged = Number(results?.[1]?.meta?.changes || 0) > 0
  return noteChanged && versionChanged
}

async function conflictResponse(env, ownerId, noteId) {
  const latest = await getIndexRow(env.DB, ownerId, noteId)
  const note = latest ? await readIndexedNote(env, latest) : null
  return json({ error: 'revision_conflict', note }, 409, latest ? { etag: `"${latest.revision}"` } : {})
}

async function putNote(request, auth, url, env, noteId) {
  const ownerId = await resolveOwner(auth, url, env)
  const body = await parseJson(request, REQUEST_MAX_BYTES)
  const note = validNote(body, noteId, ownerId)
  const current = await getIndexRow(env.DB, ownerId, noteId)
  const expected = parseExpectedRevision(request)
  const currentRevision = Number(current?.revision || 0)
  if (expected != null && expected !== currentRevision) return conflictResponse(env, ownerId, noteId)
  if (current && expected == null) return conflictResponse(env, ownerId, noteId)
  if (current && !current.deleted_at && note.updatedAt < Number(current.updated_at)) return conflictResponse(env, ownerId, noteId)

  const revision = currentRevision + 1
  const timestamp = now()
  const stored = { ...note, revision, serverUpdatedAt: timestamp }
  const serialized = JSON.stringify(stored)
  const storedSize = encoder.encode(serialized).byteLength
  if (storedSize > NOTE_MAX_BYTES) throw new HttpError(413, 'note_too_large')
  const objectKey = noteObjectKey(ownerId, noteId, revision)
  const written = await env.NOTES_BUCKET.put(objectKey, serialized, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { ownerId, noteId, revision: String(revision) },
    onlyIf: { etagDoesNotMatch: '*' },
  })
  if (!written) throw new HttpError(409, 'storage_write_conflict')
  const committed = await commitRecord(env, current, {
    ownerId,
    noteId,
    objectKey,
    revision,
    updatedAt: note.updatedAt,
    deletedAt: null,
    byteSize: storedSize,
  })
  if (!committed) return conflictResponse(env, ownerId, noteId)
  const version = await collectionVersion(env.DB, ownerId)
  await audit(env.DB, auth.user.id, 'note.put', 'note', `${ownerId}:${noteId}`, 'ok', { revision })
  return json(
    { ok: true, note: stored, collectionVersion: version },
    200,
    { etag: `"${revision}"`, 'x-notide-version': String(version) },
  )
}

async function deleteNote(request, auth, url, env, noteId) {
  const ownerId = await resolveOwner(auth, url, env)
  const current = await getIndexRow(env.DB, ownerId, noteId)
  const expected = parseExpectedRevision(request)
  const currentRevision = Number(current?.revision || 0)
  if (expected != null && expected !== currentRevision) return conflictResponse(env, ownerId, noteId)
  if (current?.deleted_at) {
    const version = await collectionVersion(env.DB, ownerId)
    return json({ ok: true, id: noteId, revision: currentRevision, collectionVersion: version }, 200, { etag: `"${currentRevision}"` })
  }
  if (current && expected == null) return conflictResponse(env, ownerId, noteId)

  const revision = currentRevision + 1
  const timestamp = now()
  const tombstone = { id: noteId, ownerId, deletedAt: timestamp, revision, serverUpdatedAt: timestamp }
  const objectKey = noteObjectKey(ownerId, noteId, revision)
  const serialized = JSON.stringify(tombstone)
  const written = await env.NOTES_BUCKET.put(objectKey, serialized, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { ownerId, noteId, revision: String(revision), deleted: 'true' },
    onlyIf: { etagDoesNotMatch: '*' },
  })
  if (!written) throw new HttpError(409, 'storage_write_conflict')
  const committed = await commitRecord(env, current, {
    ownerId,
    noteId,
    objectKey,
    revision,
    updatedAt: timestamp,
    deletedAt: timestamp,
    byteSize: encoder.encode(serialized).byteLength,
  })
  if (!committed) return conflictResponse(env, ownerId, noteId)
  const version = await collectionVersion(env.DB, ownerId)
  await audit(env.DB, auth.user.id, 'note.delete', 'note', `${ownerId}:${noteId}`, 'ok', { revision })
  return json(
    { ok: true, id: noteId, revision, collectionVersion: version },
    200,
    { etag: `"${revision}"`, 'x-notide-version': String(version) },
  )
}

function legacyNoteId(key) {
  const match = key.match(/^notes\/([^/]+)\.json$/)
  if (!match) return null
  try {
    const id = decodeURIComponent(match[1])
    return id && id.length <= 180 ? id : null
  } catch {
    return null
  }
}

async function migrateLegacyNotes(auth, url, env) {
  requireSuperAdmin(auth)
  if (!String(url.searchParams.get('ownerId') || '').trim()) throw new HttpError(400, 'owner_required')
  const ownerId = await resolveOwner(auth, url, env)
  const cursor = String(url.searchParams.get('cursor') || '')
  const listed = await env.NOTES_BUCKET.list({
    prefix: 'notes/',
    limit: 25,
    ...(cursor ? { cursor } : {}),
  })
  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const object of listed.objects || []) {
    const noteId = legacyNoteId(object.key)
    if (!noteId) {
      skipped += 1
      continue
    }
    try {
      if (await getIndexRow(env.DB, ownerId, noteId)) {
        skipped += 1
        continue
      }
      const legacy = await readObject(env.NOTES_BUCKET, object.key)
      if (!legacy) {
        failed += 1
        continue
      }
      const revision = Math.max(1, Number(legacy.revision || 1))
      const timestamp = now()
      let stored
      let updatedAt
      let deletedAt = null
      if (legacy.deletedAt) {
        deletedAt = Number(legacy.deletedAt)
        updatedAt = deletedAt
        stored = {
          id: noteId,
          ownerId,
          deletedAt,
          revision,
          serverUpdatedAt: Number(legacy.serverUpdatedAt || timestamp),
        }
      } else {
        const note = validNote(legacy, noteId, ownerId)
        updatedAt = note.updatedAt
        stored = {
          ...note,
          revision,
          serverUpdatedAt: Number(legacy.serverUpdatedAt || timestamp),
        }
      }
      const serialized = JSON.stringify(stored)
      const byteSize = encoder.encode(serialized).byteLength
      if (byteSize > NOTE_MAX_BYTES) {
        failed += 1
        continue
      }
      const objectKey = noteObjectKey(ownerId, noteId, revision)
      const written = await env.NOTES_BUCKET.put(objectKey, serialized, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: { ownerId, noteId, revision: String(revision), migrated: 'legacy-v1' },
        onlyIf: { etagDoesNotMatch: '*' },
      })
      if (!written) {
        failed += 1
        continue
      }
      const committed = await commitRecord(env, null, {
        ownerId,
        noteId,
        objectKey,
        revision,
        updatedAt,
        deletedAt,
        byteSize,
      })
      if (committed) migrated += 1
      else skipped += 1
    } catch {
      failed += 1
    }
  }

  await audit(env.DB, auth.user.id, 'migration.legacy-r2', 'collection', ownerId, failed ? 'partial' : 'ok', {
    migrated,
    skipped,
    failed,
  })
  return json({
    ok: failed === 0,
    ownerId,
    migrated,
    skipped,
    failed,
    truncated: Boolean(listed.truncated),
    cursor: listed.cursor || null,
  }, failed ? 207 : 200)
}

async function health(env) {
  try {
    await Promise.all([
      env.DB.prepare('SELECT version FROM collection_versions LIMIT 1').first(),
      env.NOTES_BUCKET.list({ prefix: 'v2/users/', limit: 1 }),
    ])
    return json({ ok: true, service: 'notide-sync', version: API_VERSION, storage: 'ready', database: 'ready' })
  } catch {
    return json({ error: 'storage_unavailable' }, 503)
  }
}

async function routeAuthenticated(request, auth, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  if (path === '/api/auth/logout') {
    if (method === 'POST') return handleLogout(auth, env)
    throw new HttpError(405, 'method_not_allowed')
  }

  await enforceRateLimit(env.DB, `api:${auth.user.id}`, API_RATE_LIMIT)
  if (auth.sessionId && now() - auth.lastSeenAt > 24 * 60 * 60_000) {
    const touch = env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now(), auth.sessionId).run()
    if (ctx?.waitUntil) ctx.waitUntil(touch)
    else await touch
  }
  if (path === '/api/me') {
    if (method === 'GET') return json({ user: auth.user })
    throw new HttpError(405, 'method_not_allowed')
  }
  if (path === '/api/health') {
    if (method === 'GET') return health(env)
    throw new HttpError(405, 'method_not_allowed')
  }

  if (path === '/api/admin/users') {
    if (method === 'GET') {
      requireAdmin(auth)
      return listUsers(auth, env)
    }
    if (method === 'POST') {
      requireSuperAdmin(auth)
      return createUser(request, auth, env)
    }
    throw new HttpError(405, 'method_not_allowed')
  }
  if (path === '/api/admin/audit') {
    requireSuperAdmin(auth)
    if (method === 'GET') return listAuditLog(url, env)
    throw new HttpError(405, 'method_not_allowed')
  }
  if (path === '/api/admin/migrations/legacy-r2') {
    requireSuperAdmin(auth)
    if (method === 'POST') return migrateLegacyNotes(auth, url, env)
    throw new HttpError(405, 'method_not_allowed')
  }
  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (userMatch) {
    requireSuperAdmin(auth)
    const id = decodeURIComponent(userMatch[1])
    if (method === 'PATCH') return updateUser(request, auth, env, id)
    if (method === 'DELETE') return deleteUser(auth, env, id)
    throw new HttpError(405, 'method_not_allowed')
  }

  if (path === '/api/notes') {
    if (method === 'GET') return listNotes(request, auth, url, env)
    throw new HttpError(405, 'method_not_allowed')
  }
  const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)
  if (noteMatch) {
    const noteId = decodeURIComponent(noteMatch[1])
    if (!noteId || noteId.length > 180) throw new HttpError(400, 'invalid_note_id')
    if (method === 'GET') return getNote(auth, url, env, noteId)
    if (method === 'PUT') return putNote(request, auth, url, env, noteId)
    if (method === 'DELETE') return deleteNote(request, auth, url, env, noteId)
    throw new HttpError(405, 'method_not_allowed')
  }

  if (path === '/') return json({ ok: true, service: 'notide-sync', version: API_VERSION })
  throw new HttpError(404, 'not_found')
}

export default {
  async fetch(request, env, ctx) {
    const finish = (response) => applyCors(response, request, env)
    if (!originAllowed(request, env)) return finish(json({ error: 'origin_forbidden' }, 403))
    if (request.method === 'OPTIONS') return finish(empty(204))
    if (!configured(env)) return finish(json({ error: 'service_not_configured' }, 503))

    try {
      const url = new URL(request.url)
      if (url.pathname === '/api/auth/login') {
        if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed')
        return finish(await handleLogin(request, env))
      }
      const auth = await authenticateRequest(request, env)
      return finish(await routeAuthenticated(request, auth, env, ctx))
    } catch (error) {
      if (error instanceof HttpError) {
        const headers = error.status === 429 ? { 'retry-after': String(error.details.retryAfter || 60) } : {}
        return finish(json({ error: error.code, ...error.details }, error.status, headers))
      }
      if (/\b(?:D1_ERROR|no such table|database is locked)\b/i.test(String(error?.message || ''))) {
        return finish(json({ error: 'database_unavailable' }, 503))
      }
      return finish(json({ error: 'internal_error' }, 500))
    }
  },
}
