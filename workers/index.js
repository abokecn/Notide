const NOTE_PREFIX = 'notes/'
const MAX_NOTE_BYTES = 1024 * 1024

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, if-match',
  'access-control-expose-headers': 'etag',
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}

function isAuthorized(request, env) {
  if (!env.SYNC_TOKEN) return true
  return request.headers.get('authorization') === `Bearer ${env.SYNC_TOKEN}`
}

function noteKey(id) {
  return `${NOTE_PREFIX}${encodeURIComponent(id)}.json`
}

async function readNote(bucket, key) {
  const object = await bucket.get(key)
  if (!object) return null
  return object.json ? object.json() : JSON.parse(await object.text())
}

function validNote(body, id) {
  if (!body || typeof body.content !== 'string') return null
  const note = {
    id,
    title: String(body.title || 'Untitled note').slice(0, 240),
    content: body.content,
    folder: String(body.folder || 'Unsorted').slice(0, 120),
    favorite: Boolean(body.favorite),
    pinned: Boolean(body.pinned),
    archived: Boolean(body.archived),
    updatedAt: Number.isFinite(body.updatedAt) ? body.updatedAt : Date.now(),
  }
  if (new TextEncoder().encode(JSON.stringify(note)).byteLength > MAX_NOTE_BYTES) return null
  return note
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
    if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401)

    const url = new URL(request.url)
    const health = url.pathname === '/api/health'
    const collection = url.pathname === '/api/notes'
    const match = url.pathname.match(/^\/api\/notes\/([^/]+)$/)

    if (health) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
      try {
        await env.NOTES_BUCKET.list({ prefix: NOTE_PREFIX, limit: 1 })
        return json(
          { ok: true, service: 'notide-sync', version: 1, storage: 'ready' },
          200,
          { 'cache-control': 'no-store' },
        )
      } catch {
        return json({ error: 'storage_unavailable' }, 503, { 'cache-control': 'no-store' })
      }
    }

    if (!collection && !match) return json({ ok: true, service: 'notide-sync', version: 1 })

    if (collection && request.method === 'GET') {
      const cursor = url.searchParams.get('cursor') || undefined
      const listed = await env.NOTES_BUCKET.list({ prefix: NOTE_PREFIX, limit: 500, ...(cursor ? { cursor } : {}) })
      const notes = []
      const deleted = []
      for (const object of listed.objects) {
        const note = await readNote(env.NOTES_BUCKET, object.key)
        if (!note) continue
        if (note.deletedAt) deleted.push(note)
        else notes.push(note)
      }
      return json({ notes, deleted, truncated: Boolean(listed.truncated), cursor: listed.cursor || null })
    }

    if (!match) return json({ error: 'method_not_allowed' }, 405)
    const id = decodeURIComponent(match[1])
    const key = noteKey(id)
    const existing = await readNote(env.NOTES_BUCKET, key)

    if (request.method === 'GET') {
      if (!existing || existing.deletedAt) return json({ error: 'note_not_found' }, 404)
      return json({ note: existing }, 200, { etag: `"${existing.revision || 0}"` })
    }

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null)
      const note = validNote(body, id)
      if (!note) return json({ error: 'invalid_note' }, 400)
      const currentRevision = existing?.revision || 0
      const expectedRevision = request.headers.get('if-match')?.replaceAll('"', '')
      if (expectedRevision && Number(expectedRevision) !== currentRevision) {
        return json({ error: 'revision_conflict', note: existing }, 409, { etag: `"${currentRevision}"` })
      }
      if (existing && !existing.deletedAt && note.updatedAt < existing.updatedAt) {
        return json({ error: 'stale_note', note: existing }, 409, { etag: `"${currentRevision}"` })
      }
      const stored = { ...note, revision: currentRevision + 1, serverUpdatedAt: Date.now() }
      await env.NOTES_BUCKET.put(key, JSON.stringify(stored), { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
      return json({ ok: true, note: stored }, 200, { etag: `"${stored.revision}"` })
    }

    if (request.method === 'DELETE') {
      const currentRevision = existing?.revision || 0
      const expectedRevision = request.headers.get('if-match')?.replaceAll('"', '')
      if (expectedRevision && Number(expectedRevision) !== currentRevision) {
        return json({ error: 'revision_conflict', note: existing }, 409, { etag: `"${currentRevision}"` })
      }
      const revision = currentRevision + 1
      const tombstone = { id, deletedAt: Date.now(), revision, serverUpdatedAt: Date.now() }
      await env.NOTES_BUCKET.put(key, JSON.stringify(tombstone), { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
      return json({ ok: true, id, revision }, 200, { etag: `"${revision}"` })
    }

    return json({ error: 'method_not_allowed' }, 405)
  },
}
