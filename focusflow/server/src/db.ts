import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  pro_since     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  notes               TEXT NOT NULL DEFAULT '',
  tag                 TEXT NOT NULL DEFAULT '',
  estimate_pomodoros  INTEGER NOT NULL DEFAULT 1,
  done                INTEGER NOT NULL DEFAULT 0,
  sort_order          REAL NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('focus','short_break','long_break')),
  planned_seconds INTEGER NOT NULL,
  actual_seconds  INTEGER NOT NULL,
  started_at      TEXT NOT NULL,
  ended_at        TEXT NOT NULL,
  completed       INTEGER NOT NULL,
  focus_rating    INTEGER,
  energy          INTEGER,
  note            TEXT NOT NULL DEFAULT '',
  tag             TEXT NOT NULL DEFAULT '',
  local_hour      INTEGER NOT NULL,
  local_weekday   INTEGER NOT NULL,
  local_date      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_time ON sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS distractions (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  category   TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_distractions_user ON distractions(user_id, at);

CREATE TABLE IF NOT EXISTS ai_cache (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  key        TEXT NOT NULL,
  json       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
`;

export type DB = DatabaseSync;

export function openDb(file = process.env.DATABASE_FILE ?? "data/focusflow.db"): DB {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
