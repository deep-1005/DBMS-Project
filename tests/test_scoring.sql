-- =====================================================================
-- CTFVault — Functional test of the scoring engine
-- Owner: Deeptha Shankar
-- Run:  psql -d ctfvault -f tests/test_scoring.sql
--
-- Verifies, against a live database:
--   T1  wrong flag is recorded but scores nothing
--   T2  first solver gets full points and the first-blood bonus
--   T3  second solver triggers decay AND the first solver's total drops
--   T4  a team cannot solve the same challenge twice
--   T5  only one first blood exists per challenge
--   T6  a locked / unreleased challenge rejects submissions
--   T7  max_solves auto-locks the challenge
--   T8  leaderboard totals equal the ledger sum
-- =====================================================================

\set ON_ERROR_STOP on
\pset format aligned

CREATE OR REPLACE FUNCTION test_flag(p_ch INTEGER, p_team INTEGER)
RETURNS CHAR(64) LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256((p_ch::TEXT || ':' || p_team::TEXT
                          || ':demo-salt')::BYTEA), 'hex')::CHAR(64);
$$;

CREATE OR REPLACE FUNCTION assert_eq(
    p_label TEXT, p_actual ANYELEMENT, p_expected ANYELEMENT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_actual IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'FAIL  %  expected=%  actual=%',
            p_label, p_expected, p_actual;
    END IF;
    RAISE NOTICE 'pass  %  (%)', p_label, p_actual;
END;
$$;

-- =====================================================================
DO $$
DECLARE
    r        RECORD;
    v_total  INTEGER;
    v_cnt    INTEGER;
    v_locked BOOLEAN;
BEGIN
    RAISE NOTICE '--- T1: wrong flag scores nothing ---';
    SELECT * INTO r FROM fn_submit_flag(
        3, 1, repeat('0', 64)::CHAR(64));          -- user deep, challenge 1
    PERFORM assert_eq('T1 accepted', r.accepted, TRUE);
    PERFORM assert_eq('T1 correct',  r.correct,  FALSE);
    PERFORM assert_eq('T1 points',   r.points_awarded, 0);

    SELECT COUNT(*) INTO v_cnt FROM score_ledger;
    PERFORM assert_eq('T1 ledger still empty', v_cnt, 0);

    RAISE NOTICE '--- T2: first solve = full points + first blood ---';
    SELECT * INTO r FROM fn_submit_flag(3, 1, test_flag(1, 1));
    PERFORM assert_eq('T2 correct',     r.correct, TRUE);
    PERFORM assert_eq('T2 first_blood', r.first_blood, TRUE);
    -- challenge 1: initial 500, min 100, decay 4 -> 1 solve = 475
    -- plus first-blood bonus of 10% of 500 = 50  -> 525
    PERFORM assert_eq('T2 points awarded', r.points_awarded, 525);

    RAISE NOTICE '--- T3: second solve decays, retroactively ---';
    SELECT * INTO r FROM fn_submit_flag(5, 1, test_flag(1, 2));
    PERFORM assert_eq('T3 correct',     r.correct, TRUE);
    PERFORM assert_eq('T3 first_blood', r.first_blood, FALSE);
    -- 2 solves -> 500 + (100-500)*(2/4)^2 = 500 - 100 = 400
    PERFORM assert_eq('T3 second solver points', r.points_awarded, 400);

    -- Team 1 must have been adjusted down from 475 to 400 (+50 bonus)
    SELECT COALESCE(SUM(points), 0) INTO v_total
      FROM score_ledger WHERE team_id = 1;
    PERFORM assert_eq('T3 team1 total after decay', v_total, 450);

    RAISE NOTICE '--- T4: no double solve by the same team ---';
    SELECT * INTO r FROM fn_submit_flag(4, 1, test_flag(1, 1));  -- rhea, team 1
    PERFORM assert_eq('T4 rejected', r.accepted, FALSE);

    RAISE NOTICE '--- T5: exactly one first blood per challenge ---';
    PERFORM fn_submit_flag(6, 1, test_flag(1, 3));
    PERFORM fn_submit_flag(7, 1, test_flag(1, 4));
    SELECT COUNT(*) INTO v_cnt
      FROM submissions WHERE challenge_id = 1 AND is_first_blood;
    PERFORM assert_eq('T5 first blood count', v_cnt, 1);

    RAISE NOTICE '--- T6: unreleased challenge is rejected ---';
    BEGIN
        PERFORM fn_submit_flag(3, 5, test_flag(5, 1));
        RAISE EXCEPTION 'FAIL  T6 unreleased challenge accepted a submission';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'pass  T6 unreleased challenge rejected';
    END;

    RAISE NOTICE '--- T7: max_solves auto-locks ---';
    -- challenge 3 has max_solves = 3
    PERFORM fn_submit_flag(3, 3, test_flag(3, 1));
    PERFORM fn_submit_flag(5, 3, test_flag(3, 2));
    PERFORM fn_submit_flag(6, 3, test_flag(3, 3));
    SELECT is_locked INTO v_locked FROM challenges WHERE challenge_id = 3;
    PERFORM assert_eq('T7 challenge locked', v_locked, TRUE);

    BEGIN
        PERFORM fn_submit_flag(7, 3, test_flag(3, 4));
        RAISE EXCEPTION 'FAIL  T7 locked challenge accepted a submission';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'pass  T7 locked challenge rejects further submissions';
    END;

    RAISE NOTICE '--- T8: leaderboard agrees with the ledger ---';
    REFRESH MATERIALIZED VIEW mv_leaderboard;
    SELECT COUNT(*) INTO v_cnt
      FROM mv_leaderboard m
      JOIN (SELECT team_id, COALESCE(SUM(points),0) AS s
              FROM score_ledger GROUP BY team_id) g
        ON g.team_id = m.team_id
     WHERE g.s <> m.total_points;
    PERFORM assert_eq('T8 leaderboard mismatches', v_cnt, 0);

    RAISE NOTICE '';
    RAISE NOTICE '==========  ALL SCORING TESTS PASSED  ==========';
END;
$$;

-- Final state, for the report screenshot
\echo ''
\echo '--- Leaderboard ---'
SELECT rank, team_name, total_points, solves, first_bloods
  FROM mv_leaderboard ORDER BY rank, team_id;

\echo ''
\echo '--- Challenge board ---'
SELECT challenge_id, title, current_points, solve_count,
       is_locked, first_blood_team
  FROM v_challenge_board ORDER BY challenge_id;
