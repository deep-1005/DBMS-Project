-- =====================================================================
-- CTFVault — Core relational schema
-- Owner: Deeptha Shankar (PES1UG24CS144)
-- Covers: identity, challenge catalogue, salted flags, submissions,
--         append-only score ledger, audit trail.
--
-- Vector/knowledge tables (writeups, chunks, hints, collusion alerts)
-- live in 10_vector_schema.sql and are owned by Subhransi.
-- =====================================================================

-- Table names are pluralised because USER is a reserved word in SQL.
-- The ER model entity USER maps to the relation users, TEAM to teams, etc.

DROP TABLE IF EXISTS audit_log       CASCADE;
DROP TABLE IF EXISTS score_ledger    CASCADE;
DROP TABLE IF EXISTS submissions     CASCADE;
DROP TABLE IF EXISTS challenge_flags CASCADE;
DROP TABLE IF EXISTS challenges      CASCADE;
DROP TABLE IF EXISTS users           CASCADE;
DROP TABLE IF EXISTS teams           CASCADE;
DROP TABLE IF EXISTS categories      CASCADE;

-- ---------------------------------------------------------------------
-- CATEGORY
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    category_id   SERIAL       PRIMARY KEY,
    name          VARCHAR(40)  NOT NULL,

    CONSTRAINT uq_category_name UNIQUE (name)
);

-- ---------------------------------------------------------------------
-- TEAM
-- ---------------------------------------------------------------------
CREATE TABLE teams (
    team_id       SERIAL       PRIMARY KEY,
    name          VARCHAR(60)  NOT NULL,
    invite_code   CHAR(10)     NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_team_name   UNIQUE (name),
    CONSTRAINT uq_team_invite UNIQUE (invite_code),
    CONSTRAINT ck_team_name_len CHECK (char_length(trim(name)) >= 2)
);

-- ---------------------------------------------------------------------
-- USER  (ER entity USER)
-- Role-based access: rubric item 11 requires a minimum of 2 roles;
-- we model 3 so that challenge authoring is separable from administration.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id       SERIAL       PRIMARY KEY,
    username      VARCHAR(32)  NOT NULL,
    email         VARCHAR(120) NOT NULL,
    password_hash CHAR(60)     NOT NULL,          -- bcrypt, never plaintext
    role          VARCHAR(10)  NOT NULL DEFAULT 'player',
    team_id       INTEGER      NULL,
    is_captain    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_user_username UNIQUE (username),
    CONSTRAINT uq_user_email    UNIQUE (email),
    CONSTRAINT fk_user_team     FOREIGN KEY (team_id)
        REFERENCES teams (team_id) ON DELETE SET NULL,
    CONSTRAINT ck_user_role     CHECK (role IN ('admin', 'setter', 'player')),
    CONSTRAINT ck_user_email    CHECK (email LIKE '%_@_%._%')
);

-- A captain must actually belong to a team.
ALTER TABLE users
    ADD CONSTRAINT ck_captain_has_team
    CHECK (NOT is_captain OR team_id IS NOT NULL);

-- ---------------------------------------------------------------------
-- CHALLENGE
-- current_points is derived state, maintained by the decay procedure.
-- decay_rate = the solve count at which a challenge bottoms out at
-- min_points (CTFd-style quadratic decay).
-- ---------------------------------------------------------------------
CREATE TABLE challenges (
    challenge_id   SERIAL       PRIMARY KEY,
    title          VARCHAR(120) NOT NULL,
    description    TEXT         NOT NULL,
    category_id    INTEGER      NOT NULL,
    author_id      INTEGER      NOT NULL,
    initial_points INTEGER      NOT NULL,
    min_points     INTEGER      NOT NULL,
    decay_rate     INTEGER      NOT NULL DEFAULT 25,
    current_points INTEGER      NOT NULL,
    solve_count    INTEGER      NOT NULL DEFAULT 0,
    max_solves     INTEGER      NULL,
    is_locked      BOOLEAN      NOT NULL DEFAULT FALSE,
    released_at    TIMESTAMPTZ  NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_challenge_title UNIQUE (title),
    CONSTRAINT fk_challenge_category FOREIGN KEY (category_id)
        REFERENCES categories (category_id) ON DELETE RESTRICT,
    CONSTRAINT fk_challenge_author   FOREIGN KEY (author_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,

    CONSTRAINT ck_points_order   CHECK (min_points <= initial_points),
    CONSTRAINT ck_points_positive CHECK (min_points > 0),
    CONSTRAINT ck_current_in_band
        CHECK (current_points BETWEEN min_points AND initial_points),
    CONSTRAINT ck_decay_positive CHECK (decay_rate > 0),
    CONSTRAINT ck_solve_count    CHECK (solve_count >= 0),
    CONSTRAINT ck_max_solves     CHECK (max_solves IS NULL OR max_solves > 0)
);

-- ---------------------------------------------------------------------
-- CHALLENGE_FLAG
-- One HMAC-salted flag per (challenge, team). A leaked flag therefore
-- identifies the team it was issued to — rubric item 13.
-- Only the hash is stored; the plaintext flag never touches the database.
-- ---------------------------------------------------------------------
CREATE TABLE challenge_flags (
    flag_id       SERIAL       PRIMARY KEY,
    challenge_id  INTEGER      NOT NULL,
    team_id       INTEGER      NOT NULL,
    flag_hash     CHAR(64)     NOT NULL,          -- sha256 hex
    generated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT fk_flag_challenge FOREIGN KEY (challenge_id)
        REFERENCES challenges (challenge_id) ON DELETE CASCADE,
    CONSTRAINT fk_flag_team      FOREIGN KEY (team_id)
        REFERENCES teams (team_id) ON DELETE CASCADE,
    CONSTRAINT uq_flag_per_team  UNIQUE (challenge_id, team_id)
);

-- ---------------------------------------------------------------------
-- SUBMISSION
-- A promoted relationship: it has its own identity because SCORE_LEDGER
-- references it.
-- ---------------------------------------------------------------------
CREATE TABLE submissions (
    submission_id  BIGSERIAL    PRIMARY KEY,
    challenge_id   INTEGER      NOT NULL,
    team_id        INTEGER      NOT NULL,
    user_id        INTEGER      NOT NULL,
    submitted_hash CHAR(64)     NOT NULL,
    is_correct     BOOLEAN      NOT NULL DEFAULT FALSE,
    is_first_blood BOOLEAN      NOT NULL DEFAULT FALSE,
    submitted_at   TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT fk_sub_challenge FOREIGN KEY (challenge_id)
        REFERENCES challenges (challenge_id) ON DELETE CASCADE,
    CONSTRAINT fk_sub_team      FOREIGN KEY (team_id)
        REFERENCES teams (team_id) ON DELETE CASCADE,
    CONSTRAINT fk_sub_user      FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,

    -- A first blood is necessarily a correct submission.
    CONSTRAINT ck_first_blood_correct
        CHECK (NOT is_first_blood OR is_correct)
);

-- ---------------------------------------------------------------------
-- SCORE_LEDGER
-- Append-only. Team totals are DERIVED, never stored, so that retroactive
-- decay adjustments keep full history instead of overwriting it.
-- ---------------------------------------------------------------------
CREATE TABLE score_ledger (
    entry_id      BIGSERIAL    PRIMARY KEY,
    team_id       INTEGER      NOT NULL,
    challenge_id  INTEGER      NOT NULL,
    submission_id BIGINT       NULL,
    points        INTEGER      NOT NULL,
    entry_type    VARCHAR(16)  NOT NULL,
    -- clock_timestamp(), NOT now(): now() is the transaction timestamp, so
    -- every row a single trigger writes would share it and the leaderboard
    -- tie-break (earliest-to-reach-the-total wins) could not separate teams.
    awarded_at    TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT fk_ledger_team FOREIGN KEY (team_id)
        REFERENCES teams (team_id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_challenge FOREIGN KEY (challenge_id)
        REFERENCES challenges (challenge_id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_submission FOREIGN KEY (submission_id)
        REFERENCES submissions (submission_id) ON DELETE SET NULL,

    CONSTRAINT ck_ledger_type CHECK (entry_type IN
        ('solve', 'first_blood', 'decay_adjust', 'hint_penalty'))
);

-- ---------------------------------------------------------------------
-- AUDIT_LOG
-- Written only by triggers. Rubric item 12 (integrity) and 13 (security).
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    log_id       BIGSERIAL    PRIMARY KEY,
    actor_id     INTEGER      NULL,
    table_name   VARCHAR(40)  NOT NULL,
    record_id    BIGINT       NOT NULL,
    action       VARCHAR(10)  NOT NULL,
    old_value    JSONB        NULL,
    new_value    JSONB        NULL,
    occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id)
        REFERENCES users (user_id) ON DELETE SET NULL,
    CONSTRAINT ck_audit_action CHECK (action IN ('INSERT', 'UPDATE', 'DELETE'))
);
