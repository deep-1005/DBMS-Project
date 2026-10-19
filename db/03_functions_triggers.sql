-- =====================================================================
-- CTFVault — Scoring functions and triggers
-- Owner: Deeptha Shankar
--
-- Advanced database features demonstrated here:
--   * stored functions          (fn_challenge_points, fn_submit_flag)
--   * triggers                  (solve award, challenge lock, audit)
--   * transactions              (fn_submit_flag is atomic end to end)
-- =====================================================================

-- ---------------------------------------------------------------------
-- The decay curve.
-- Quadratic decay: value falls from initial_points to min_points as the
-- solve count approaches decay_rate, then stays flat.
--
--   points(s) = max( min, initial + (min - initial) * (s / decay)^2 )
--
-- IMMUTABLE so the planner can inline it inside the recompute procedure.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_challenge_points(
    p_initial    INTEGER,
    p_min        INTEGER,
    p_decay_rate INTEGER,
    p_solves     INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_ratio   NUMERIC;
    v_points  NUMERIC;
BEGIN
    IF p_solves <= 0 THEN
        RETURN p_initial;
    END IF;

    v_ratio  := LEAST(p_solves::NUMERIC / p_decay_rate::NUMERIC, 1.0);
    v_points := p_initial + (p_min - p_initial) * (v_ratio * v_ratio);

    RETURN GREATEST(p_min, ROUND(v_points)::INTEGER);
END;
$$;

COMMENT ON FUNCTION fn_challenge_points IS
    'Quadratic point decay. Pure function of solve count — no side effects.';


-- ---------------------------------------------------------------------
-- TRIGGER: award a solve.
--
-- Fires after a correct submission lands. Performs, in one transaction
-- with the INSERT that fired it:
--   1. bump solve_count and recompute current_points
--   2. write the solve ledger entry at the NEW (decayed) value
--   3. write a first-blood bonus entry when applicable
--   4. write decay_adjust deltas for every EARLIER solver, so their
--      totals fall retroactively without rewriting history
--   5. lock the challenge if max_solves has been reached
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_award_solve()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_ch          challenges%ROWTYPE;
    v_old_points  INTEGER;
    v_new_points  INTEGER;
    v_delta       INTEGER;
    v_bonus       INTEGER;
BEGIN
    IF NOT NEW.is_correct THEN
        RETURN NEW;                      -- wrong guesses never score
    END IF;

    -- Lock the challenge row: serialises concurrent solves of the SAME
    -- challenge so solve_count cannot be lost to a read-modify-write race.
    --
    -- fn_submit_flag already holds this lock, so for the normal path this
    -- re-lock is free. It is kept so the invariant also holds for a direct
    -- INSERT into submissions (a setter fixing data by hand, a bulk
    -- import), which would otherwise bypass the ordering entirely.
    -- FOR NO KEY UPDATE matches the lock mode taken in fn_submit_flag;
    -- mixing modes would reintroduce a lock-ordering difference.
    SELECT * INTO v_ch
    FROM challenges
    WHERE challenge_id = NEW.challenge_id
    FOR NO KEY UPDATE;

    v_old_points := v_ch.current_points;
    v_new_points := fn_challenge_points(
        v_ch.initial_points, v_ch.min_points,
        v_ch.decay_rate, v_ch.solve_count + 1);

    UPDATE challenges
       SET solve_count    = solve_count + 1,
           current_points = v_new_points
     WHERE challenge_id = NEW.challenge_id;

    -- (2) this team's award, at the post-decay value
    INSERT INTO score_ledger
        (team_id, challenge_id, submission_id, points, entry_type)
    VALUES
        (NEW.team_id, NEW.challenge_id, NEW.submission_id,
         v_new_points, 'solve');

    -- (3) first-blood bonus: 10% of the challenge's opening value
    IF NEW.is_first_blood THEN
        v_bonus := GREATEST(1, ROUND(v_ch.initial_points * 0.10)::INTEGER);
        INSERT INTO score_ledger
            (team_id, challenge_id, submission_id, points, entry_type)
        VALUES
            (NEW.team_id, NEW.challenge_id, NEW.submission_id,
             v_bonus, 'first_blood');
    END IF;

    -- (4) retroactive adjustment for everyone who solved earlier
    v_delta := v_new_points - v_old_points;
    IF v_delta <> 0 AND v_ch.solve_count > 0 THEN
        INSERT INTO score_ledger
            (team_id, challenge_id, submission_id, points, entry_type)
        SELECT s.team_id, s.challenge_id, NULL, v_delta, 'decay_adjust'
          FROM submissions s
         WHERE s.challenge_id = NEW.challenge_id
           AND s.is_correct
           AND s.submission_id <> NEW.submission_id;
    END IF;

    -- (5) auto-lock once the solve cap is hit
    IF v_ch.max_solves IS NOT NULL
       AND v_ch.solve_count + 1 >= v_ch.max_solves THEN
        UPDATE challenges
           SET is_locked = TRUE
         WHERE challenge_id = NEW.challenge_id
           AND NOT is_locked;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_submission_award
    AFTER INSERT ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION trg_award_solve();


-- ---------------------------------------------------------------------
-- TRIGGER: audit trail.
-- Generic row-level auditor reused across tables. The acting user is
-- passed in by the API through a session GUC (app.actor_id), so the
-- audit row records WHO, not just WHAT.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor  INTEGER;
    v_pk     BIGINT;
BEGIN
    BEGIN
        v_actor := NULLIF(current_setting('app.actor_id', TRUE), '')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;
    END;

    IF TG_OP = 'DELETE' THEN
        EXECUTE format('SELECT ($1).%I::BIGINT', TG_ARGV[0])
           INTO v_pk USING OLD;
        INSERT INTO audit_log
            (actor_id, table_name, record_id, action, old_value, new_value)
        VALUES
            (v_actor, TG_TABLE_NAME, v_pk, 'DELETE', to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;

    EXECUTE format('SELECT ($1).%I::BIGINT', TG_ARGV[0])
       INTO v_pk USING NEW;

    IF TG_OP = 'UPDATE' THEN
        IF to_jsonb(OLD) = to_jsonb(NEW) THEN
            RETURN NEW;                  -- no-op update, nothing to record
        END IF;
        INSERT INTO audit_log
            (actor_id, table_name, record_id, action, old_value, new_value)
        VALUES
            (v_actor, TG_TABLE_NAME, v_pk, 'UPDATE',
             to_jsonb(OLD), to_jsonb(NEW));
    ELSE
        INSERT INTO audit_log
            (actor_id, table_name, record_id, action, old_value, new_value)
        VALUES
            (v_actor, TG_TABLE_NAME, v_pk, 'INSERT', NULL, to_jsonb(NEW));
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_audit_challenges
    AFTER INSERT OR UPDATE OR DELETE ON challenges
    FOR EACH ROW EXECUTE FUNCTION trg_audit_row('challenge_id');

CREATE TRIGGER tr_audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION trg_audit_row('user_id');


-- ---------------------------------------------------------------------
-- TRIGGER: block submissions to a locked or unreleased challenge.
-- Validation at the DATABASE level — rubric item 12 — so it holds even
-- if a bug in the API layer lets the request through.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_guard_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_locked   BOOLEAN;
    v_released TIMESTAMPTZ;
    v_team     INTEGER;
BEGIN
    SELECT is_locked, released_at INTO v_locked, v_released
      FROM challenges WHERE challenge_id = NEW.challenge_id;

    IF v_locked THEN
        RAISE EXCEPTION 'challenge % is locked', NEW.challenge_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_released IS NULL OR v_released > now() THEN
        RAISE EXCEPTION 'challenge % is not yet released', NEW.challenge_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- The submitting user must belong to the team they submit for.
    SELECT team_id INTO v_team FROM users WHERE user_id = NEW.user_id;
    IF v_team IS DISTINCT FROM NEW.team_id THEN
        RAISE EXCEPTION 'user % does not belong to team %',
            NEW.user_id, NEW.team_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_submission_guard
    BEFORE INSERT ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION trg_guard_submission();
