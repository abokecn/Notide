const collectionPath = '/api/notes'

export async function syncWorkspace({ endpoint, token = '', notes = [], tombstones = [], fetchImpl = globalThis.fetch }) {
  const base = endpoint?.trim().replace(/\/$/, '')
  if (!base) return { notes, tombstones, uploaded: 0, downloaded: 0 }
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable')

  const { remoteNotes, remoteDeleted } = await fetchRemoteNotes(base, token, fetchImpl)
  const remoteById = new Map([...remoteNotes, ...remoteDeleted].map((item) => [item.id, item]))
  const localById = new Map(notes.map((note) => [note.id, note]))
  const localDeletedById = new Map(tombstones.map((item) => [item.id, item]))
  let uploaded = 0
  let downloaded = 0

  for (const remote of remoteNotes) {
    const local = localById.get(remote.id)
    const localDeleted = localDeletedById.get(remote.id)
    if (localDeleted && localDeleted.deletedAt >= remote.updatedAt) {
      await deleteRemote(base, token, remote, remote.revision, fetchImpl)
      localById.delete(remote.id)
      remoteById.set(remote.id, { ...remote, deletedAt: localDeleted.deletedAt, revision: remote.revision })
      uploaded += 1
      continue
    }
    if (!local || remote.updatedAt > local.updatedAt) {
      localById.set(remote.id, remote)
      localDeletedById.delete(remote.id)
      downloaded += 1
    }
  }

  for (const remote of remoteDeleted) {
    const local = localById.get(remote.id)
    const localDeleted = localDeletedById.get(remote.id)
    if (local && local.updatedAt > remote.deletedAt) {
      const saved = await putRemote(base, token, local, remote.revision, fetchImpl)
      localById.set(saved.id, saved)
      localDeletedById.delete(remote.id)
      uploaded += 1
    } else if (!localDeleted || remote.deletedAt > localDeleted.deletedAt) {
      localById.delete(remote.id)
      localDeletedById.set(remote.id, { id: remote.id, deletedAt: remote.deletedAt, revision: remote.revision })
      downloaded += 1
    }
  }

  for (const local of localById.values()) {
    const remote = remoteById.get(local.id)
    if (!remote || remote.deletedAt || local.updatedAt > remote.updatedAt) {
      const saved = await putRemote(base, token, local, remote?.revision, fetchImpl)
      localById.set(saved.id, saved)
      localDeletedById.delete(saved.id)
      uploaded += 1
    }
  }

  for (const localDeleted of localDeletedById.values()) {
    const remote = remoteById.get(localDeleted.id)
    if (!remote || (!remote.deletedAt && localDeleted.deletedAt > remote.updatedAt) || (remote.deletedAt && localDeleted.deletedAt > remote.deletedAt)) {
      await deleteRemote(base, token, remote || localDeleted, remote?.revision, fetchImpl)
      uploaded += 1
    }
  }

  return { notes: Array.from(localById.values()), tombstones: Array.from(localDeletedById.values()), uploaded, downloaded }
}

async function fetchRemoteNotes(base, token, fetchImpl) {
  const remoteNotes = []
  const remoteDeleted = []
  let cursor = ''
  let pages = 0
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const response = await fetchImpl(`${base}${collectionPath}${query}`, { headers: authHeaders(token) })
    if (!response.ok) throw new Error(`sync_fetch_${response.status}`)
    const payload = await response.json()
    if (Array.isArray(payload.notes)) remoteNotes.push(...payload.notes)
    if (Array.isArray(payload.deleted)) remoteDeleted.push(...payload.deleted)
    cursor = payload.truncated ? payload.cursor || '' : ''
    pages += 1
  } while (cursor && pages < 20)
  return { remoteNotes, remoteDeleted }
}

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function putRemote(base, token, note, revision, fetchImpl) {
  const headers = { ...authHeaders(token), 'content-type': 'application/json' }
  if (revision != null) headers['if-match'] = `"${revision}"`
  const response = await fetchImpl(`${base}${collectionPath}/${encodeURIComponent(note.id)}`, { method: 'PUT', headers, body: JSON.stringify(note) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 409 && payload.note && payload.note.updatedAt >= note.updatedAt) return payload.note
    throw new Error(`sync_put_${response.status}`)
  }
  return payload.note || note
}

async function deleteRemote(base, token, remote, revision, fetchImpl) {
  const headers = { ...authHeaders(token) }
  const currentRevision = revision ?? remote.revision
  if (currentRevision != null) headers['if-match'] = `"${currentRevision}"`
  const response = await fetchImpl(`${base}${collectionPath}/${encodeURIComponent(remote.id)}`, { method: 'DELETE', headers })
  if (!response.ok && response.status !== 404) throw new Error(`sync_delete_${response.status}`)
}
