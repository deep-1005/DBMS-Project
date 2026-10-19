-- =====================================================================
-- CTFVault — Indexes and partial unique constraints (core)
-- Owner: Deeptha Shankar
--
-- The two partial unique indexes below are the concurrency story in
-- schema form: they make an invalid state physically unrepresentable
-- rather than relying on application code to prevent it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Correctness-enforcing partial unique indexes
-- ---------------------------------------------------------------------

-- A team may hold at most ONE correct submission per challenge.
-- Partial, because wrong submissions are expected to repeat freely.
CREATE UNIQUE INDEX uq_one_solve_per_team
    ON submissions (challenge_id, team_id)
    WHERE is_correct;

-- A challenge may have at most ONE first blood, ever.
-- Two teams submitting the correct flag in the same millisecond cannot
-- both be crowned: the second INSERT is rejected by the database.
CREATE UNIQUE INDEX uq_one_first_blood
    ON submissions (challenge_id)
    WHERE is_first_blood;

-- ---------------------------------------------------------------------
-- Access-path indexes
-- ---------------------------------------------------------------------

-- Leaderboard aggregation and per-team score history.
CREATE INDEX ix_ledger_team         ON score_ledger (team_id);
CREATE INDEX ix_ledger_challenge    ON score_ledger (challenge_id);
CREATE INDEX ix_ledger_team_awarded ON score_ledger (team_id, awarded_at DESC);

-- Submission feed and per-challenge solve lookups.
CREATE INDEX ix_sub_challenge_time ON submissions (challenge_id, submitted_at DESC);
CREATE INDEX ix_sub_team_time      ON submissions (team_id, submitted_at DESC);

-- Rate-limiting / brute-force detection reads only recent wrong guesses,
-- so the index is partial on the minority case.
CREATE INDEX ix_sub_wrong_recent
    ON submissions (team_id, submitted_at DESC)
    WHERE NOT is_correct;

-- Flag verification is the hot path on every submission.
CREATE INDEX ix_flag_lookup ON challenge_flags (challenge_id, team_id);

-- Challenge board filtering.
CREATE INDEX ix_challenge_category ON challenges (category_id);
CREATE INDEX ix_challenge_visible
    ON challenges (released_at)
    WHERE NOT is_locked;

-- Team roster lookups.
CREATE INDEX ix_user_team ON users (team_id) WHERE team_id IS NOT NULL;

-- Audit queries are almost always "what happened to this record".
CREATE INDEX ix_audit_record ON audit_log (table_name, record_id, occurred_at DESC);
