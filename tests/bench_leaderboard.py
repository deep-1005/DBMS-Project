#!/usr/bin/env python3
"""
CTFVault — leaderboard benchmark
Owner: Deeptha Shankar

Measures the cost of the leaderboard query two ways at a realistic ledger
size, to justify materialising it:

  LIVE  aggregate score_ledger on every page load
  MVIEW read mv_leaderboard, refreshed on a debounce

Also reports the cost of the refresh itself, since that is what the
materialised approach trades away.

Usage:
    python3 tests/bench_leaderboard.py --ledger-rows 500000 --runs 20
"""

import argparse
import os
import statistics
import time

import psycopg2

DSN = os.environ.get(
    "CTFVAULT_TEST_DSN",
    "host=/tmp port=5433 user=postgres dbname=ctfvault",
)

LIVE_SQL = """
SELECT t.team_id,
       t.name,
       COALESCE(SUM(l.points), 0) AS total_points,
       COUNT(*) FILTER (WHERE l.entry_type = 'solve') AS solves,
       MAX(l.awarded_at) AS last_award_at
  FROM teams t
  LEFT JOIN score_ledger l ON l.team_id = t.team_id
 GROUP BY t.team_id, t.name
 ORDER BY total_points DESC, last_award_at ASC
 LIMIT 50;
"""

MVIEW_SQL = """
SELECT rank, team_id, team_name, total_points, solves, first_bloods
  FROM mv_leaderboard
 ORDER BY rank, team_id
 LIMIT 50;
"""


def inflate(cur, target_rows):
    """Pad score_ledger up to target_rows using existing teams/challenges."""
    cur.execute("SELECT COUNT(*) FROM score_ledger")
    have = cur.fetchone()[0]
    if have >= target_rows:
        return have

    need = target_rows - have
    print(f"  inflating ledger by {need:,} rows ...", flush=True)
    cur.execute(
        """
        INSERT INTO score_ledger
            (team_id, challenge_id, submission_id, points, entry_type,
             awarded_at)
        SELECT t.team_id,
               c.challenge_id,
               NULL,
               (random() * 400 + 50)::INT,
               'decay_adjust',
               now() - (random() * INTERVAL '48 hours')
          FROM generate_series(1, %s) g
         CROSS JOIN LATERAL (
               SELECT team_id FROM teams ORDER BY random() LIMIT 1) t
         CROSS JOIN LATERAL (
               SELECT challenge_id FROM challenges ORDER BY random() LIMIT 1) c
        """,
        (need,),
    )
    cur.execute("SELECT COUNT(*) FROM score_ledger")
    return cur.fetchone()[0]


def timed(cur, sql, runs):
    samples = []
    for _ in range(runs):
        t0 = time.perf_counter()
        cur.execute(sql)
        cur.fetchall()
        samples.append((time.perf_counter() - t0) * 1000)
    return samples


def explain(cur, sql):
    cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql)
    return "\n".join(r[0] for r in cur.fetchall())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger-rows", type=int, default=500_000)
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--explain", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()

    print("Preparing fixture")
    total = inflate(cur, args.ledger_rows)
    cur.execute("ANALYZE score_ledger")
    print(f"  score_ledger rows: {total:,}")

    print("  refreshing materialized view ...", flush=True)
    t0 = time.perf_counter()
    cur.execute("REFRESH MATERIALIZED VIEW mv_leaderboard")
    refresh_ms = (time.perf_counter() - t0) * 1000

    # Warm the cache so we compare steady-state, not first-touch I/O.
    timed(cur, LIVE_SQL, 2)
    timed(cur, MVIEW_SQL, 2)

    print(f"\nTiming {args.runs} runs each\n")
    live = timed(cur, LIVE_SQL, args.runs)
    mview = timed(cur, MVIEW_SQL, args.runs)

    def row(label, s):
        return (f"{label:<28} {statistics.median(s):>9.2f} "
                f"{min(s):>9.2f} {max(s):>9.2f}")

    print(f"{'':<28} {'median':>9} {'min':>9} {'max':>9}   (ms)")
    print("-" * 60)
    print(row("Live aggregate", live))
    print(row("Materialized view read", mview))
    print("-" * 60)
    print(f"{'Speedup (median)':<28} "
          f"{statistics.median(live) / statistics.median(mview):>8.1f}x")
    print(f"{'Full refresh cost':<28} {refresh_ms:>9.2f} ms")

    t0 = time.perf_counter()
    cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard")
    conc_ms = (time.perf_counter() - t0) * 1000
    print(f"{'Concurrent refresh cost':<28} {conc_ms:>9.2f} ms")

    if args.explain:
        print("\n--- EXPLAIN ANALYZE: live aggregate ---")
        print(explain(cur, LIVE_SQL))
        print("\n--- EXPLAIN ANALYZE: materialized view ---")
        print(explain(cur, MVIEW_SQL))

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
