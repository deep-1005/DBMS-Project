-- =====================================================================
-- CTFVault — spread the demo event over a realistic time window
-- Owner: Deeptha Shankar
--
-- seed_demo.mjs replays the whole event in about a second, so every row
-- would otherwise carry the same clock time. This script re-times the
-- history: it spaces all submissions evenly across the last six hours and
-- moves each score-ledger entry to match the submission that caused it.
-- Only timestamps change. Points, ranks and solve order are untouched.
-- Run by `npm run db:demo` after the event has been played.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Submissions: even spacing, in the order they were played.
WITH ordered AS (
    SELECT submission_id,
           ROW_NUMBER() OVER (ORDER BY submission_id) AS n,
           COUNT(*)     OVER ()                       AS total
      FROM submissions
)
UPDATE submissions s
   SET submitted_at = (now() - INTERVAL '6 hours')
                    + (o.n::DOUBLE PRECISION / o.total) * INTERVAL '355 minutes'
  FROM ordered o
 WHERE o.submission_id = s.submission_id;

-- 2. Ledger rows that came from a submission take that submission's time
--    (plus a microsecond offset so entries from one solve stay in order).
UPDATE score_ledger l
   SET awarded_at = s.submitted_at + l.entry_id * INTERVAL '1 microsecond'
  FROM submissions s
 WHERE s.submission_id = l.submission_id;

-- 3. Decay adjustments and hint penalties have no submission of their own:
--    they happened right after the nearest earlier entry that does.
UPDATE score_ledger l
   SET awarded_at = COALESCE(
           (SELECT x.awarded_at
              FROM score_ledger x
             WHERE x.submission_id IS NOT NULL
               AND x.entry_id < l.entry_id
             ORDER BY x.entry_id DESC
             LIMIT 1),
           l.awarded_at)
         + l.entry_id * INTERVAL '1 microsecond'
 WHERE l.submission_id IS NULL;

COMMIT;

REFRESH MATERIALIZED VIEW mv_leaderboard;

SELECT MIN(submitted_at) AS event_start,
       MAX(submitted_at) AS event_end,
       COUNT(*)          AS submissions
  FROM submissions;
