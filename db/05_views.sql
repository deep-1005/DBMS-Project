-- =====================================================================
-- CTFVault — Views and materialized views
-- Owner: Deeptha Shankar
--
-- The leaderboard is a GROUP BY over an append-only ledger, so it grows
-- without bound. Materialising it turns an O(ledger) aggregate into an
-- O(teams) index scan; CONCURRENTLY keeps it readable during refresh,
-- which requires the unique index below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- mv_leaderboard — the scoreboard.
-- Ties are broken by EARLIEST last-scoring-event, so the team that
-- reached the total first ranks higher. That is standard CTF practice
-- and the reason last_award_at is carried in the view.
-- ---------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_leaderboard CASCADE;

CREATE MATERIALIZED VIEW mv_leaderboard AS
SELECT
    t.team_id,
    t.name                                           AS team_name,
    COALESCE(SUM(l.points), 0)::INTEGER              AS total_points,
    COUNT(*) FILTER (WHERE l.entry_type = 'solve')   AS solves,
    COUNT(*) FILTER (WHERE l.entry_type = 'first_blood') AS first_bloods,
    MAX(l.awarded_at)                                AS last_award_at,
    RANK() OVER (
        ORDER BY COALESCE(SUM(l.points), 0) DESC,
                 MAX(l.awarded_at) ASC NULLS LAST
    )                                                AS rank
FROM teams t
LEFT JOIN score_ledger l ON l.team_id = t.team_id
GROUP BY t.team_id, t.name;

-- Required for REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX uq_mv_leaderboard_team ON mv_leaderboard (team_id);
CREATE INDEX ix_mv_leaderboard_rank        ON mv_leaderboard (rank);


-- ---------------------------------------------------------------------
-- v_challenge_board — what a player sees on the challenge list.
-- Demonstrates JOIN + GROUP BY + aggregate + subquery in one view.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_challenge_board AS
SELECT
    c.challenge_id,
    c.title,
    cat.name                      AS category,
    c.current_points,
    c.solve_count,
    c.is_locked,
    u.username                    AS author,
    (SELECT t.name
       FROM submissions s
       JOIN teams t ON t.team_id = s.team_id
      WHERE s.challenge_id = c.challenge_id
        AND s.is_first_blood
      LIMIT 1)                    AS first_blood_team,
    ROUND(
        100.0 * c.solve_count /
        NULLIF((SELECT COUNT(*) FROM teams), 0), 1
    )                             AS solve_rate_pct
FROM challenges c
JOIN categories cat ON cat.category_id = c.category_id
JOIN users u        ON u.user_id = c.author_id
WHERE c.released_at IS NOT NULL
  AND c.released_at <= now();


-- ---------------------------------------------------------------------
-- v_team_score_history — per-team audit of how a total was reached.
-- Window function gives the running total, which the UI plots.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_team_score_history AS
SELECT
    l.team_id,
    l.entry_id,
    l.awarded_at,
    c.title       AS challenge,
    l.entry_type,
    l.points,
    SUM(l.points) OVER (
        PARTITION BY l.team_id
        ORDER BY l.awarded_at, l.entry_id
    )             AS running_total
FROM score_ledger l
JOIN challenges c ON c.challenge_id = l.challenge_id;


-- ---------------------------------------------------------------------
-- v_suspicious_submission_rate — teams guessing far more than they solve.
-- A cheap, non-vector integrity signal that complements the embedding
-- based collusion detection. HAVING clause demonstrates grouped filtering.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_suspicious_submission_rate AS
SELECT
    t.team_id,
    t.name                                      AS team_name,
    COUNT(*)                                    AS attempts,
    COUNT(*) FILTER (WHERE s.is_correct)        AS solves,
    ROUND(COUNT(*)::NUMERIC
          / NULLIF(COUNT(*) FILTER (WHERE s.is_correct), 0), 1)
                                                AS attempts_per_solve
FROM teams t
JOIN submissions s ON s.team_id = t.team_id
GROUP BY t.team_id, t.name
HAVING COUNT(*) >= 20
   AND COUNT(*)::NUMERIC
       / NULLIF(COUNT(*) FILTER (WHERE s.is_correct), 0) > 25
ORDER BY attempts_per_solve DESC;
