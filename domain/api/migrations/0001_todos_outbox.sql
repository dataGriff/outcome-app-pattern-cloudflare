-- Operational store for the todo domain (D1/SQLite). IDs and timestamps are
-- app-supplied: D1 batch statements cannot read each other's results, so the
-- request handler is the one clock both rows share.

-- Every row is owned by a user (the Cloudflare Access `sub` claim) and every
-- query is scoped WHERE user_id = ? — the operational store never answers
-- across users.
CREATE TABLE IF NOT EXISTS todos (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS todos_user_created_idx
    ON todos (user_id, created_at DESC);

-- Transactional outbox: written in the same atomic batch as the todo mutation
-- above, drained to the events queue by the relay. This is what removes the
-- dual-write.
CREATE TABLE IF NOT EXISTS outbox (
    id           TEXT PRIMARY KEY,
    subject      TEXT NOT NULL,
    payload      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    published_at TEXT
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
    ON outbox (created_at)
    WHERE published_at IS NULL;
