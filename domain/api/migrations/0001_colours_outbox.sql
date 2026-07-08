-- Operational store for the behaviour domain (D1/SQLite port of the source
-- repo's Postgres schema). IDs and timestamps are app-supplied: D1 batch
-- statements cannot read each other's results, so the request handler is the
-- one clock both rows share.

CREATE TABLE IF NOT EXISTS colours (
    id         TEXT PRIMARY KEY,
    colour     TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Transactional outbox: written in the same atomic batch as the colour above,
-- drained to the events queue by the relay. This is what removes the dual-write.
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
