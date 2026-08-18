import { normalizeSyncEndpoint } from './sync.js'

const SESSION_PREFIX = 'notide-session-v04'
const WORKSPACE_PREFIX = 'notide-workspace-v04'

export class AuthError extends Error {
  constructor(code, { status = null, details = null, cause } = {}) {
    super(code)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    this.details = details
    if (cause) this.cause = cause
  }
}

export function accountScope(endpoint, userId) {
  const base = normalizeSyncEndpoint(endpoint)
  const principal = String(userId || '').trim()
  if (!principal) throw new AuthError('user_required')
  return `${encodeURIComponent(new URL(base).origin)}:${encodeURIComponent(principal)}`
}

export function workspaceKeys(endpoint, userId) {
  const scope = accountScope(endpoint, userId)
  return {
    notes: `${WORKSPACE_PREFIX}:${scope}:notes`,
    tombstones: `${WORKSPACE_PREFIX}:${scope}:tombstones`,
    ui: `${WORKSPACE_PREFIX}:${scope}:ui`,
    sync: `${WORKSPACE_PREFIX}:${scope}:sync`,
  }
}

export function sessionKey(endpoint) {
  const base = normalizeSyncEndpoint(endpoint)
  return `${SESSION_PREFIX}:${encodeURIComponent(new URL(base).origin)}`
}

export function loadSession(endpoint, { local = globalThis.localStorage, session = globalThis.sessionStorage } = {}) {
  if (!endpoint || !local || !session) return null
  const key = sessionKey(endpoint)
  for (const storage of [session, local]) {
    try {
      const value = JSON.parse(storage.getItem(key) || 'null')
      if (!value?.token || !value?.user?.id) continue
      if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) {
        storage.removeItem(key)
        continue
      }
      return value
    } catch {
      storage.removeItem(key)
    }
  }
  return null
}

export function persistSession(endpoint, value, remember, { local = globalThis.localStorage, session = globalThis.sessionStorage } = {}) {
  if (!local || !session) return
  const key = sessionKey(endpoint)
  local.removeItem(key)
  session.removeItem(key)
  if (!value?.token || !value?.user?.id) return
  ;(remember ? local : session).setItem(key, JSON.stringify(value))
}

export function clearSession(endpoint, stores) {
  persistSession(endpoint, null, false, stores)
}

export async function login({ endpoint, username, password, remember = false, fetchImpl = globalThis.fetch }) {
  const value = await request(endpoint, '/api/auth/login', {
    method: 'POST',
    body: { username: String(username || '').trim(), password: String(password || '') },
    fetchImpl,
  })
  if (!value?.token || !value?.user?.id) throw new AuthError('invalid_auth_response')
  return { token: value.token, user: value.user, expiresAt: value.expiresAt || null, remember }
}

export async function logout({ endpoint, token, fetchImpl = globalThis.fetch }) {
  return request(endpoint, '/api/auth/logout', { method: 'POST', token, fetchImpl })
}

export async function getMe({ endpoint, token, fetchImpl = globalThis.fetch }) {
  const value = await request(endpoint, '/api/me', { token, fetchImpl })
  if (!value?.user?.id) throw new AuthError('invalid_auth_response')
  return value.user
}

export async function listUsers({ endpoint, token, fetchImpl = globalThis.fetch }) {
  const value = await request(endpoint, '/api/admin/users', { token, fetchImpl })
  return Array.isArray(value?.users) ? value.users : []
}

export async function createUser({ endpoint, token, user, fetchImpl = globalThis.fetch }) {
  return request(endpoint, '/api/admin/users', { method: 'POST', token, body: user, fetchImpl })
}

export async function updateUser({ endpoint, token, userId, changes, fetchImpl = globalThis.fetch }) {
  return request(endpoint, `/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', token, body: changes, fetchImpl })
}

export async function listAuditLog({ endpoint, token, cursor = '', fetchImpl = globalThis.fetch }) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return request(endpoint, `/api/admin/audit${query}`, { token, fetchImpl })
}

export async function request(endpoint, path, { method = 'GET', token = '', body, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new AuthError('fetch_unavailable')
  const base = normalizeSyncEndpoint(endpoint)
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let response
  try {
    response = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      cache: 'no-store',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (cause) {
    throw new AuthError('network_error', { cause })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const fallback = response.status === 401 ? 'unauthorized'
      : response.status === 403 ? 'forbidden'
        : response.status === 429 ? 'rate_limited'
          : response.status >= 500 ? 'service_unavailable'
            : 'request_failed'
    throw new AuthError(payload?.error || fallback, { status: response.status, details: payload })
  }
  return payload
}
