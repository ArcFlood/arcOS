export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT    PRIMARY KEY,
    title       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    tags        TEXT    NOT NULL DEFAULT '[]',
    total_cost  REAL    NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id               TEXT    PRIMARY KEY,
    conversation_id  TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT    NOT NULL,
    content          TEXT    NOT NULL,
    model            TEXT,
    model_label      TEXT,
    cost             REAL    NOT NULL DEFAULT 0,
    timestamp        INTEGER NOT NULL,
    routing_reason   TEXT
  );

  CREATE TABLE IF NOT EXISTS spending_log (
    id               TEXT  PRIMARY KEY,
    date             TEXT  NOT NULL,
    model            TEXT  NOT NULL,
    amount           REAL  NOT NULL,
    conversation_id  TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_spending_date ON spending_log(date);
`
