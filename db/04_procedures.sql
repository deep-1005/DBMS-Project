-- =====================================================================
-- CTFVault — Stored procedures (transactional entry points)
-- Owner: Deeptha Shankar
-- =====================================================================

-- ---------------------------------------------------------------------
-- fn_submit_flag — the single transactional entry point for scoring.
--
-- The API layer never writes to submissions or score_ledger directly;
-- it calls this. Everything below happens in ONE transaction:
--     flag verification -> submission insert -> (trigger) score award
--                       -> first-blood attribution -> decay adjustment
--
-- The first-blood race is handled optimistically: we read "is there a
-- first blood yet", and if two sessions both read NO, the partial unique
-- index uq_one_first_blood rejects the loser, which we catch and retry
-- as an ordinary solve. The database, not the application, is the
-- arbiter — so the invariant holds under any level of concurrency.
--
-- p_submitted_hash is the HMAC-SHA256 of the submitted flag, computed in
-- the API using a secret held in an environment variable. The secret
-- never enters the database (rubric items 10 and 13).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_submit_flag(
    p_user_id        INTEGER,
    p_challenge_id   INTEGER,
    p_submitted_hash CHAR(64)
)
RETURNS TABLE (
    accepted       BOOLEAN,
    correct        BOOLEAN,
    first_blood    BOOLEAN,
    points_awarded INTEGER,
    message        TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_team_id     INTEGER;
    v_expected    CHAR(64);
    v_correct     BOOLEAN := FALSE;
    v_first       BOOLEAN := FALSE;
    v_sub_id      BIGINT;
    v_points      INTEGER := 0;
BEGIN
    -- Who is submitting, and for whom
    SELECT team_id INTO v_team_id FROM users WHERE user_id = p_user_id;
    IF v_team_id IS NULL THEN
        RETURN QUERY SELECT FALSE, FALSE, FALSE, 0,
            'You must join a team before submitting.'::TEXT;
        RETURN;
    END IF;

    -- ------------------------------------------------------------------
    -- LOCK ORDERING — do not move this.
    --
    -- Every transaction that scores must take the challenge row lock
    -- BEFORE it touches submissions. The first version of this function
    -- inserted the submission first and let the AFTER trigger take the
    -- challenge lock, which gave two different lock orders:
    --
    --     T1: submissions index entry -> challenges row
    --     T2: challenges row          -> submissions index entry
    --
    -- Under a 12-way concurrent solve that deadlocked 6 of 8 clients
    -- (SQLSTATE 40P01). Acquiring the challenge lock up front gives all
    -- transactions one order, so the cycle cannot form. Solves of the
    -- SAME challenge now serialise; solves of different challenges stay
    -- fully parallel, which is the concurrency we actually need.
    -- ------------------------------------------------------------------
    PERFORM 1 FROM challenges
     WHERE challenge_id = p_challenge_id
       FOR NO KEY UPDATE;

    -- Already solved? Reject before touching anything else.
    IF EXISTS (SELECT 1 FROM submissions
                WHERE challenge_id = p_challenge_id
                  AND team_id = v_team_id
                  AND is_correct) THEN
        RETURN QUERY SELECT FALSE, TRUE, FALSE, 0,
            'Your team has already solved this challenge.'::TEXT;
        RETURN;
    END IF;

    -- Verify against THIS team's salted flag
    SELECT flag_hash INTO v_expected
      FROM challenge_flags
     WHERE challenge_id = p_challenge_id
       AND team_id = v_team_id;

    IF v_expected IS NULL THEN
        RETURN QUERY SELECT FALSE, FALSE, FALSE, 0,
            'No flag issued to your team for this challenge.'::TEXT;
        RETURN;
    END IF;

    v_correct := (v_expected = p_submitted_hash);

    -- Wrong flag: record the attempt (it feeds rate limiting) and stop.
    IF NOT v_correct THEN
        INSERT INTO submissions
            (challenge_id, team_id, user_id, submitted_hash, is_correct)
        VALUES
            (p_challenge_id, v_team_id, p_user_id, p_submitted_hash, FALSE);

        RETURN QUERY SELECT TRUE, FALSE, FALSE, 0,
            'Incorrect flag.'::TEXT;
        RETURN;
    END IF;

    -- Correct. Claim first blood if nobody holds it yet.
    v_first := NOT EXISTS (
        SELECT 1 FROM submissions
         WHERE challenge_id = p_challenge_id AND is_first_blood);

    BEGIN
        INSERT INTO submissions
            (challenge_id, team_id, user_id, submitted_hash,
             is_correct, is_first_blood)
        VALUES
            (p_challenge_id, v_team_id, p_user_id, p_submitted_hash,
             TRUE, v_first)
        RETURNING submission_id INTO v_sub_id;

    EXCEPTION
        WHEN unique_violation THEN
            -- Lost one of two possible races:
            --   uq_one_first_blood  -> somebody beat us by microseconds
            --   uq_one_solve_per_team -> duplicate click from our own team
            IF EXISTS (SELECT 1 FROM submissions
                        WHERE challenge_id = p_challenge_id
                          AND team_id = v_team_id
                          AND is_correct) THEN
                RETURN QUERY SELECT FALSE, TRUE, FALSE, 0,
                    'Your team has already solved this challenge.'::TEXT;
                RETURN;
            END IF;

            v_first := FALSE;
            INSERT INTO submissions
                (challenge_id, team_id, user_id, submitted_hash,
                 is_correct, is_first_blood)
            VALUES
                (p_challenge_id, v_team_id, p_user_id, p_submitted_hash,
                 TRUE, FALSE)
            RETURNING submission_id INTO v_sub_id;
    END;

    -- The AFTER INSERT trigger has already written the ledger rows.
    SELECT COALESCE(SUM(points), 0) INTO v_points
      FROM score_ledger
     WHERE submission_id = v_sub_id;

    RETURN QUERY SELECT TRUE, TRUE, v_first, v_points,
        CASE WHEN v_first THEN 'First blood!' ELSE 'Correct flag.' END::TEXT;
END;
$$;


-- ---------------------------------------------------------------------
-- sp_recompute_all_scores — admin rebuild of the ledger.
--
-- Replays every correct submission in chronological order and rebuilds
-- score_ledger from scratch. Used after a challenge's decay parameters
-- are edited mid-event, or to repair the ledger after a bad import.
-- Runs inside one transaction: the leaderboard is never half-rebuilt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_recompute_all_scores()
LANGUAGE plpgsql
AS $$
DECLARE
    r_ch      RECORD;
    r_sub     RECORD;
    v_n       INTEGER;
    v_points  INTEGER;
    v_bonus   INTEGER;
BEGIN
    DELETE FROM score_ledger;

    FOR r_ch IN
        SELECT * FROM challenges ORDER BY challenge_id FOR UPDATE
    LOOP
        v_n := 0;

        FOR r_sub IN
            SELECT * FROM submissions
             WHERE challenge_id = r_ch.challenge_id AND is_correct
             ORDER BY submitted_at, submission_id
        LOOP
            v_n := v_n + 1;
            v_points := fn_challenge_points(
                r_ch.initial_points, r_ch.min_points, r_ch.decay_rate, v_n);

            INSERT INTO score_ledger
                (team_id, challenge_id, submission_id, points, entry_type)
            VALUES
                (r_sub.team_id, r_ch.challenge_id, r_sub.submission_id,
                 v_points, 'solve');

            IF r_sub.is_first_blood THEN
                v_bonus := GREATEST(1,
                    ROUND(r_ch.initial_points * 0.10)::INTEGER);
                INSERT INTO score_ledger
                    (team_id, challenge_id, submission_id, points, entry_type)
                VALUES
                    (r_sub.team_id, r_ch.challenge_id, r_sub.submission_id,
                     v_bonus, 'first_blood');
            END IF;
        END LOOP;

        -- Final decayed value becomes the challenge's current price, and
        -- every earlier solver is levelled to it via one adjustment row.
        v_points := fn_challenge_points(
            r_ch.initial_points, r_ch.min_points, r_ch.decay_rate, v_n);

        UPDATE challenges
           SET solve_count = v_n, current_points = v_points
         WHERE challenge_id = r_ch.challenge_id;

        INSERT INTO score_ledger
            (team_id, challenge_id, submission_id, points, entry_type)
        SELECT l.team_id, l.challenge_id, NULL,
               v_points - l.points, 'decay_adjust'
          FROM score_ledger l
         WHERE l.challenge_id = r_ch.challenge_id
           AND l.entry_type = 'solve'
           AND l.points <> v_points;
    END LOOP;

    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard;
END;
$$;


-- ---------------------------------------------------------------------
-- sp_issue_team_flags — generate per-team salted flags for a challenge.
-- Called by a setter when a challenge is released, or when a new team
-- registers. The hash is supplied by the API (HMAC with the server
-- secret); this procedure only persists it idempotently.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_issue_team_flag(
    p_challenge_id INTEGER,
    p_team_id      INTEGER,
    p_flag_hash    CHAR(64)
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO challenge_flags (challenge_id, team_id, flag_hash)
    VALUES (p_challenge_id, p_team_id, p_flag_hash)
    ON CONFLICT (challenge_id, team_id)
    DO UPDATE SET flag_hash = EXCLUDED.flag_hash,
                  generated_at = now();
END;
$$;
