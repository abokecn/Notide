const collectionPath = '/api/notes'
const healthPath = '/api/health'

export class SyncConnectionError extends Error {
  constructor(code, { status = null, cause } = {}) {
    super(code)
    this.name = 'SyncConnectionError'
    this.code = code
    this.status = status
    if (cause) this.cause = cause
  }
}

export class SyncRequestError extends Error {
  constructor(code, { status = 0, retryAfter = null, payload = null, cause } = {}) {
    super(code)
    this.name = 'SyncRequestError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
    this.payload = payload
    if (cause) this.cause = cause
  }
}

export function normalizeSyncEndpoint(endpoint) {
  const value = String(endpoint || '').trim()
  if (!value) throw new SyncConnectionError('sync_endpoint_required')

  let url
  try {
    url = new URL(value)
  } catch (cause) {
    throw new SyncConnectionError('sync_endpoint_invalid', { cause })
  }

  if (!['http:', 'https:'].includes(url.protocol)) throw new SyncConnectionError('sync_endpoint_protocol')
  if (url.username || url.password || url.search || url.hash) throw new SyncConnectionError('sync_endpoint_invalid')

  const hostname = url.hostname.toLowerCase()
  const localHttp = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname.endsWith('.localhost')
  if (url.protocol === 'http:' && !localHttp) throw new SyncConnectionError('sync_endpoint_insecure')

  url.pathname = url.pathname.replace(/\/api\/notes\/?$/i, '').replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export async function testSyncConnection({ endpoint, token = '', fetchImpl = globalThis.fetch, signal } = {}) {
  const base = normalizeSyncEndpoint(endpoint)
  if (typeof fetchImpl !== 'function') throw new SyncConnectionError('sync_fetch_unavailable')

  const options = { method: 'GET', headers: { ...authHeaders(token), accept: 'application/json' }, signal }
  const healthResponse = await connectionFetch(`${base}${healthPath}`, options, fetchImpl)

  if (healthResponse.status === 404) return testLegacyConnection(base, options, fetchImpl)
  assertConnectionStatus(healthResponse)
  const payload = await connectionJson(healthResponse)

  if (payload?.ok === true && payload.service === 'notide-sync' && payload.storage === 'ready' && Number.isFinite(payload.version)) {
    return {
      ok: true,
      endpoint: base,
      service: payload.service,
      version: payload.version,
      storage: payload.storage,
      database: payload.database || null,
      legacy: false,
    }
  }

  if (payload?.service === 'notide-sync' && Number.isFinite(payload.version)) {
    return testLegacyConnection(base, options, fetchImpl)
  }
  throw new SyncConnectionError('sync_service_mismatch')
}

export async function syncWorkspace({
  endpoint,
  token = '',
  ownerId = '',
  notes = [],
  tombstones = [],
  collectionVersion = 0,
  collectionEtag = '',
  dirtyIds = [],
  fetchImpl = globalThis.fetch,
  signal,
  now = Date.now,
} = {}) {
  if (!String(endpoint || '').trim()) {
    return {
      notes,
      tombstones,
      uploaded: 0,
      downloaded: 0,
      collectionVersion,
      collectionEtag,
      notModified: true,
      changed: false,
      conflicts: [],
    }
  }
  const base = normalizeSyncEndpoint(endpoint)
  if (typeof fetchImpl !== 'function') throw new SyncRequestError('fetch_unavailable')

  const remote = await fetchRemoteNotes(base, token, {
    ownerId,
    collectionVersion,
    collectionEtag,
    fetchImpl,
    signal,
  })
  const remoteById = new Map([...remote.remoteNotes, ...remote.remoteDeleted].map((item) => [item.id, item]))
  const localById = new Map(notes.map((note) => [note.id, note]))
  const localDeletedById = new Map(tombstones.map((item) => [item.id, item]))
  const dirty = new Set((dirtyIds || []).map(String))
  const fullDirty = dirty.has('*') || Number(collectionVersion || 0) === 0
  const explicitlyDirty = (id) => dirty.has('*') || dirty.has(String(id))
  let uploaded = 0
  let downloaded = 0
  let nextVersion = Number(remote.version ?? collectionVersion ?? 0)
  const conflicts = []

  for (const remoteNote of remote.remoteNotes) {
    const local = localById.get(remoteNote.id)
    const localDeleted = localDeletedById.get(remoteNote.id)
    if (localDeleted && (explicitlyDirty(remoteNote.id) || localDeleted.deletedAt >= remoteNote.updatedAt)) {
      try {
        const expectedRevision = localDeleted.revision ?? (remoteNote ? (explicitlyDirty(remoteNote.id) ? 0 : remoteNote.revision) : null)
        const deleted = await deleteRemote(base, token, ownerId, remoteNote, expectedRevision, fetchImpl, signal)
        nextVersion = Math.max(nextVersion, Number(deleted.collectionVersion || 0))
        localById.delete(remoteNote.id)
        remoteById.set(remoteNote.id, { ...remoteNote, deletedAt: localDeleted.deletedAt, revision: deleted.revision ?? remoteNote.revision })
        uploaded += 1
      } catch (error) {
        if (error?.status !== 409 || !error?.payload?.note) throw error
        const latest = error.payload.note
        if (latest.deletedAt) localDeletedById.set(latest.id, latest)
        else {
          localById.set(latest.id, latest)
          localDeletedById.delete(latest.id)
        }
        downloaded += 1
        conflicts.push({ noteId: remoteNote.id, copyId: null })
      }
      continue
    }
    if (local && explicitlyDirty(remoteNote.id) && !sameRecord(local, remoteNote)) continue
    if (!local || remoteIsNewer(remoteNote, local)) {
      localById.set(remoteNote.id, remoteNote)
      localDeletedById.delete(remoteNote.id)
      if (!local || !sameRecord(local, remoteNote)) downloaded += 1
    }
  }

  for (const remoteDeleted of remote.remoteDeleted) {
    const local = localById.get(remoteDeleted.id)
    const localDeleted = localDeletedById.get(remoteDeleted.id)
    if (local && (explicitlyDirty(remoteDeleted.id) || local.updatedAt > remoteDeleted.deletedAt)) continue
    if (!localDeleted || remoteDeleted.deletedAt > localDeleted.deletedAt || remoteDeleted.revision > (localDeleted.revision || 0)) {
      localById.delete(remoteDeleted.id)
      localDeletedById.set(remoteDeleted.id, remoteDeleted)
      downloaded += 1
    }
  }

  for (const local of [...localById.values()]) {
    const remoteRecord = remoteById.get(local.id)
    const shouldConsider = fullDirty || dirty.has(String(local.id)) || local.revision == null || Boolean(remoteRecord)
    if (!shouldConsider) continue
    const localIsExplicitlyDirty = explicitlyDirty(local.id)
    if (!remoteRecord || remoteRecord.deletedAt || local.updatedAt > remoteRecord.updatedAt || (localIsExplicitlyDirty && !sameRecord(local, remoteRecord))) {
      const expectedRevision = local.revision ?? (remoteRecord ? (localIsExplicitlyDirty ? 0 : remoteRecord.revision) : null)
      try {
        const saved = await putRemote(base, token, ownerId, local, expectedRevision, fetchImpl, signal)
        localById.set(saved.note.id, saved.note)
        localDeletedById.delete(saved.note.id)
        nextVersion = Math.max(nextVersion, Number(saved.collectionVersion || 0))
        uploaded += 1
      } catch (error) {
        if (error?.status !== 409 || !error?.payload?.note) throw error
        const latest = error.payload.note
        const conflictCopy = createConflictCopy(local, now())
        const savedCopy = await putRemote(base, token, ownerId, conflictCopy, null, fetchImpl, signal)
        localById.set(savedCopy.note.id, savedCopy.note)
        if (latest.deletedAt) {
          localById.delete(local.id)
          localDeletedById.set(local.id, latest)
        } else {
          localById.set(local.id, latest)
          localDeletedById.delete(local.id)
        }
        nextVersion = Math.max(nextVersion, Number(savedCopy.collectionVersion || 0))
        uploaded += 1
        downloaded += 1
        conflicts.push({ noteId: local.id, copyId: savedCopy.note.id })
      }
    }
  }

  for (const localDeleted of [...localDeletedById.values()]) {
    const remoteRecord = remoteById.get(localDeleted.id)
    const shouldConsider = fullDirty || dirty.has(String(localDeleted.id)) || localDeleted.revision == null || Boolean(remoteRecord)
    if (!shouldConsider) continue
    if (!remoteRecord || explicitlyDirty(localDeleted.id) || (!remoteRecord.deletedAt && localDeleted.deletedAt > remoteRecord.updatedAt) || (remoteRecord.deletedAt && localDeleted.deletedAt > remoteRecord.deletedAt)) {
      try {
        const expectedRevision = localDeleted.revision ?? (remoteRecord ? (explicitlyDirty(localDeleted.id) ? 0 : remoteRecord.revision) : null)
        const deleted = await deleteRemote(
          base,
          token,
          ownerId,
          remoteRecord || localDeleted,
          expectedRevision,
          fetchImpl,
          signal,
        )
        const nextTombstone = {
          ...localDeleted,
          revision: deleted.revision ?? localDeleted.revision,
          ...(deleted.serverUpdatedAt ? { serverUpdatedAt: deleted.serverUpdatedAt } : {}),
        }
        localDeletedById.set(localDeleted.id, nextTombstone)
        nextVersion = Math.max(nextVersion, Number(deleted.collectionVersion || 0))
        uploaded += 1
      } catch (error) {
        if (error?.status !== 409 || !error?.payload?.note) throw error
        const latest = error.payload.note
        if (latest.deletedAt) localDeletedById.set(latest.id, latest)
        else {
          localById.set(latest.id, latest)
          localDeletedById.delete(latest.id)
        }
        downloaded += 1
        conflicts.push({ noteId: localDeleted.id, copyId: null })
      }
    }
  }

  const nextNotes = reuseArray(notes, Array.from(localById.values()))
  const nextTombstones = reuseArray(tombstones, Array.from(localDeletedById.values()))
  const changed = nextNotes !== notes || nextTombstones !== tombstones
  return {
    notes: nextNotes,
    tombstones: nextTombstones,
    uploaded,
    downloaded,
    collectionVersion: nextVersion,
    collectionEtag: uploaded ? '' : remote.etag,
    notModified: remote.notModified && uploaded === 0,
    changed,
    conflicts,
  }
}

async function fetchRemoteNotes(base, token, { ownerId, collectionVersion, collectionEtag, fetchImpl, signal }) {
  const incremental = Number(collectionVersion || 0) > 0
  try {
    return await fetchRemotePages(base, token, {
      ownerId,
      since: incremental ? Number(collectionVersion) : null,
      etag: incremental ? '' : collectionEtag,
      fetchImpl,
      signal,
    })
  } catch (error) {
    if (error?.status === 409 && ['sync_version_ahead', 'sync_reset_required'].includes(error?.payload?.error)) {
      return fetchRemotePages(base, token, { ownerId, since: null, etag: '', fetchImpl, signal })
    }
    throw error
  }
}

async function fetchRemotePages(base, token, { ownerId, since, etag, fetchImpl, signal }) {
  const remoteById = new Map()
  let cursor = ''
  let pages = 0
  let version = since || 0
  let responseEtag = etag || ''
  do {
    const query = new URLSearchParams()
    if (ownerId) query.set('ownerId', ownerId)
    if (since != null && !cursor) query.set('since', String(since))
    if (cursor) query.set('cursor', cursor)
    const headers = { ...authHeaders(token), accept: 'application/json' }
    if (etag && !cursor && since == null) headers['if-none-match'] = etag
    const url = `${base}${collectionPath}${query.size ? `?${query}` : ''}`
    const response = await requestFetch(url, { headers, signal }, fetchImpl)
    if (response.status === 304) {
      return {
        remoteNotes: [],
        remoteDeleted: [],
        version: numericHeader(response, 'x-notide-version', version),
        etag: response.headers.get('etag') || etag,
        notModified: true,
      }
    }
    if (!response.ok) throw await requestError(response, 'sync_fetch')
    const payload = await responseJson(response, 'sync_response_invalid')
    if (!Array.isArray(payload.notes) || !Array.isArray(payload.deleted)) throw new SyncRequestError('sync_response_invalid', { status: response.status, payload })
    for (const record of [...payload.notes, ...payload.deleted]) {
      if (!record?.id) throw new SyncRequestError('sync_response_invalid', { status: response.status, payload })
      const previous = remoteById.get(record.id)
      if (!previous || Number(record.revision || 0) >= Number(previous.revision || 0)) remoteById.set(record.id, record)
    }
    const responseVersion = Number(payload.collectionVersion ?? payload.version ?? numericHeader(response, 'x-notide-version', version))
    if (!Number.isInteger(responseVersion) || responseVersion < 0) throw new SyncRequestError('sync_response_invalid', { status: response.status, payload })
    version = responseVersion
    responseEtag = response.headers.get('etag') || responseEtag
    cursor = payload.truncated ? String(payload.cursor || '') : ''
    if (payload.truncated && !cursor) throw new SyncRequestError('sync_cursor_missing', { status: response.status, payload })
    pages += 1
  } while (cursor && pages < 50)
  if (cursor) throw new SyncRequestError('sync_page_limit')
  const records = [...remoteById.values()]
  const remoteNotes = records.filter((record) => !record.deletedAt)
  const remoteDeleted = records.filter((record) => record.deletedAt)
  return { remoteNotes, remoteDeleted, version, etag: responseEtag, notModified: remoteNotes.length === 0 && remoteDeleted.length === 0 }
}

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {}
}

function ownerQuery(ownerId) {
  return ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ''
}

async function testLegacyConnection(base, options, fetchImpl) {
  const response = await connectionFetch(`${base}${collectionPath}`, options, fetchImpl)
  assertConnectionStatus(response)
  const payload = await connectionJson(response)
  if (!Array.isArray(payload?.notes) || !Array.isArray(payload?.deleted)) {
    throw new SyncConnectionError('sync_response_invalid')
  }
  return { ok: true, endpoint: base, service: 'notide-sync', version: 1, storage: 'ready', database: null, legacy: true }
}

async function connectionFetch(url, options, fetchImpl) {
  try {
    return await fetchImpl(url, options)
  } catch (cause) {
    if (cause?.name === 'AbortError') throw new SyncConnectionError('sync_connection_aborted', { cause })
    throw new SyncConnectionError('sync_network_or_cors', { cause })
  }
}

function assertConnectionStatus(response) {
  if (response.ok) return
  if (response.status === 401) throw new SyncConnectionError('sync_auth_unauthorized', { status: response.status })
  if (response.status === 403) throw new SyncConnectionError('sync_auth_forbidden', { status: response.status })
  if (response.status === 404) throw new SyncConnectionError('sync_endpoint_not_found', { status: response.status })
  if (response.status === 503) throw new SyncConnectionError('sync_storage_unavailable', { status: response.status })
  if (response.status >= 500) throw new SyncConnectionError('sync_service_unavailable', { status: response.status })
  throw new SyncConnectionError('sync_connection_rejected', { status: response.status })
}

async function connectionJson(response) {
  try {
    return await response.json()
  } catch (cause) {
    throw new SyncConnectionError('sync_response_invalid', { status: response.status, cause })
  }
}

async function putRemote(base, token, ownerId, note, revision, fetchImpl, signal) {
  const headers = { ...authHeaders(token), 'content-type': 'application/json', accept: 'application/json' }
  if (revision != null) headers['if-match'] = `"${revision}"`
  const response = await requestFetch(
    `${base}${collectionPath}/${encodeURIComponent(note.id)}${ownerQuery(ownerId)}`,
    { method: 'PUT', headers, body: JSON.stringify(note), signal },
    fetchImpl,
  )
  const payload = await responseJson(response, 'sync_response_invalid', true)
  if (!response.ok) throw requestErrorFromPayload(response, 'sync_put', payload)
  return {
    note: payload.note || note,
    collectionVersion: Number(payload.collectionVersion ?? numericHeader(response, 'x-notide-version', 0)),
  }
}

async function deleteRemote(base, token, ownerId, remote, revision, fetchImpl, signal) {
  const headers = { ...authHeaders(token), accept: 'application/json' }
  const currentRevision = revision ?? remote.revision
  if (currentRevision != null) headers['if-match'] = `"${currentRevision}"`
  const response = await requestFetch(
    `${base}${collectionPath}/${encodeURIComponent(remote.id)}${ownerQuery(ownerId)}`,
    { method: 'DELETE', headers, signal },
    fetchImpl,
  )
  const payload = await responseJson(response, 'sync_response_invalid', true)
  if (!response.ok && response.status !== 404) throw requestErrorFromPayload(response, 'sync_delete', payload)
  return {
    revision: payload.revision ?? currentRevision,
    serverUpdatedAt: payload.serverUpdatedAt,
    collectionVersion: Number(payload.collectionVersion ?? numericHeader(response, 'x-notide-version', 0)),
  }
}

async function requestFetch(url, options, fetchImpl) {
  try {
    return await fetchImpl(url, options)
  } catch (cause) {
    if (cause?.name === 'AbortError') throw new SyncRequestError('sync_aborted', { cause })
    throw new SyncRequestError('sync_network', { cause })
  }
}

async function requestError(response, prefix) {
  const payload = await responseJson(response, 'sync_response_invalid', true)
  return requestErrorFromPayload(response, prefix, payload)
}

function requestErrorFromPayload(response, prefix, payload) {
  return new SyncRequestError(`${prefix}_${response.status}`, {
    status: response.status,
    retryAfter: parseRetryAfter(response.headers.get('retry-after')),
    payload,
  })
}

async function responseJson(response, code, optional = false) {
  try {
    const text = await response.text()
    if (!text && optional) return {}
    return JSON.parse(text)
  } catch (cause) {
    if (optional) return {}
    throw new SyncRequestError(code, { status: response.status, cause })
  }
}

function parseRetryAfter(value) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : null
}

function numericHeader(response, name, fallback) {
  const value = Number(response.headers.get(name))
  return Number.isFinite(value) ? value : fallback
}

function remoteIsNewer(remote, local) {
  if (Number(remote.updatedAt || 0) !== Number(local.updatedAt || 0)) return Number(remote.updatedAt || 0) > Number(local.updatedAt || 0)
  return Number(remote.revision || 0) > Number(local.revision || 0)
}

function sameRecord(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false
    if (left[leftKeys[index]] !== right[rightKeys[index]]) return false
  }
  return true
}

function reuseArray(original, next) {
  const originalById = new Map(original.map((item) => [item.id, item]))
  const reused = next.map((item) => {
    const previous = originalById.get(item.id)
    return previous && sameRecord(previous, item) ? previous : item
  })
  if (reused.length === original.length && reused.every((item, index) => item === original[index])) return original
  return reused
}

function createConflictCopy(note, timestamp) {
  const safeTimestamp = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now()
  const suffix = `${safeTimestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const baseId = String(note.id || 'note').slice(0, Math.max(1, 180 - suffix.length - 10))
  const { revision: _revision, serverUpdatedAt: _serverUpdatedAt, ownerId: _ownerId, ...copy } = note
  return {
    ...copy,
    id: `${baseId}-conflict-${suffix}`,
    title: `${String(note.title || 'Untitled')} (conflict)`,
    updatedAt: safeTimestamp,
    conflictOf: String(note.id || ''),
  }
}
