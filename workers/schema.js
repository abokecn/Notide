export const NOTIDE_SCHEMA_SQL = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'user')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS collection_versions (
  owner_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS note_index (
  owner_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  change_version INTEGER NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, note_id)
);

CREATE INDEX IF NOT EXISTS note_index_delta_idx
  ON note_index(owner_id, change_version, note_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_actor_time_idx ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rate (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const readyDatabases = new WeakMap()

export function ensureDatabaseSchema(database) {
  if (!database || typeof database.exec !== 'function') {
    return Promise.reject(new Error('D1 exec is unavailable'))
  }

  const existing = readyDatabases.get(database)
  if (existing) return existing

  const initialization = Promise.resolve()
    .then(() => database.exec(NOTIDE_SCHEMA_SQL))
    .catch((error) => {
      readyDatabases.delete(database)
      throw error
    })
  readyDatabases.set(database, initialization)
  return initialization
}
