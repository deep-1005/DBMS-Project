-- CTFVault knowledge layer: writeups, embeddings, hints and review alerts.
-- Requires db/01_core_schema.sql through db/06_seed.sql.

CREATE EXTENSION IF NOT EXISTS vector;

DROP TABLE IF EXISTS collusion_alerts CASCADE;
DROP TABLE IF EXISTS hint_unlocks CASCADE;
DROP TABLE IF EXISTS hints CASCADE;
DROP TABLE IF EXISTS writeup_chunks CASCADE;
DROP TABLE IF EXISTS writeups CASCADE;

CREATE TABLE writeups (
    writeup_id    SERIAL PRIMARY KEY,
    challenge_id  INTEGER NOT NULL REFERENCES challenges(challenge_id) ON DELETE CASCADE,
    team_id       INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    author_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    title         VARCHAR(160) NOT NULL,
    body          TEXT NOT NULL,
    published     BOOLEAN NOT NULL DEFAULT FALSE,
    search_vector TSVECTOR NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_writeup_team_challenge UNIQUE (challenge_id, team_id),
    CONSTRAINT ck_writeup_title CHECK (char_length(trim(title)) >= 3),
    CONSTRAINT ck_writeup_body CHECK (char_length(trim(body)) >= 80)
);

CREATE TABLE writeup_chunks (
    chunk_id    BIGSERIAL PRIMARY KEY,
    writeup_id  INTEGER NOT NULL REFERENCES writeups(writeup_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content     TEXT NOT NULL,
    embedding   VECTOR(384),
    token_count INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_chunk_position UNIQUE (writeup_id, chunk_index),
    CONSTRAINT ck_chunk_index CHECK (chunk_index >= 0),
    CONSTRAINT ck_chunk_tokens CHECK (token_count > 0)
);

CREATE TABLE hints (
    hint_id       SERIAL PRIMARY KEY,
    challenge_id  INTEGER NOT NULL REFERENCES challenges(challenge_id) ON DELETE CASCADE,
    title         VARCHAR(120) NOT NULL,
    body          TEXT NOT NULL,
    cost          INTEGER NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_hint_cost CHECK (cost > 0),
    CONSTRAINT ck_hint_order CHECK (display_order > 0),
    CONSTRAINT uq_hint_order UNIQUE (challenge_id, display_order)
);

CREATE TABLE hint_unlocks (
    team_id     INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    hint_id     INTEGER NOT NULL REFERENCES hints(hint_id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, hint_id)
);

CREATE TABLE collusion_alerts (
    alert_id    BIGSERIAL PRIMARY KEY,
    writeup_a_id INTEGER NOT NULL REFERENCES writeups(writeup_id) ON DELETE CASCADE,
    writeup_b_id INTEGER NOT NULL REFERENCES writeups(writeup_id) ON DELETE CASCADE,
    distance    REAL NOT NULL,
    status      VARCHAR(12) NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    CONSTRAINT ck_alert_order CHECK (writeup_a_id < writeup_b_id),
    CONSTRAINT ck_alert_distance CHECK (distance >= 0 AND distance <= 2),
    CONSTRAINT ck_alert_status CHECK (status IN ('pending', 'confirmed', 'dismissed')),
    CONSTRAINT uq_alert_pair UNIQUE (writeup_a_id, writeup_b_id)
);

CREATE OR REPLACE FUNCTION set_writeup_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_writeup_search_vector
BEFORE INSERT OR UPDATE OF title, body ON writeups
FOR EACH ROW EXECUTE FUNCTION set_writeup_search_vector();
