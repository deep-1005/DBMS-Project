#!/usr/bin/env python3
"""
CTFVault — first-blood concurrency proof
Owner: Deeptha Shankar

Demonstrates that the first-blood invariant ("at most one team is ever
awarded first blood on a challenge") is enforced by the DATABASE, not by
application logic.

Two runs, identical workload:

  UNSAFE  the partial unique index uq_one_first_blood is dropped, so the
          check-then-insert in fn_submit_flag is a textbook race. Many
          teams read "nobody has first blood yet" before any of them has
          inserted, and all of them are awarded it.

  SAFE    the index is present. The same race still happens at the read,
          but every loser's INSERT is rejected by the database; the
          function catches unique_violation and retries as a plain solve.

Usage:
    python3 tests/concurrency_test.py --teams 60 --rounds 10
"""

import argparse
import hashlib
import json
import os
import statistics
import sys
import threading
import time

import psycopg2

DSN = os.environ.get(
    "CTFVAULT_TEST_DSN",
    "host=/tmp port=5433 user=postgres dbname=ctfvault",
)
SALT = os.environ.get("CTFVAULT_FLAG_SALT", "demo-salt")


def flag_hash(challenge_id: int, team_id: int) -> str:
    """Mirror of the per-team salted flag used by the seed data."""
    raw = f"{challenge_id}:{team_id}:{SALT}".encode()
    return hashlib.sha256(raw).hexdigest()


def connect():
    return psycopg2.connect(DSN)


# ---------------------------------------------------------------------
# Fixture: a fresh challenge plus N teams, each with one player and one
# salted flag, so every team can legitimately solve simultaneously.
# ---------------------------------------------------------------------
def build_fixture(n_teams: int, round_no: int):
    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()

    title = f"RACE-{round_no}-{int(time.time()*1000)}"
    cur.execute(
        """
        INSERT INTO challenges
            (title, description, category_id, author_id,
             initial_points, min_points, decay_rate, current_points,
             released_at)
        VALUES (%s, 'concurrency fixture', 1, 2,
                500, 100, 100, 500, now() - INTERVAL '1 minute')
        RETURNING challenge_id
        """,
        (title,),
    )
    challenge_id = cur.fetchone()[0]

    pairs = []
    for i in range(n_teams):
        tag = f"{round_no}-{i}-{int(time.time()*1000) % 100000}"
        cur.execute(
            "INSERT INTO teams (name, invite_code) VALUES (%s, %s) "
            "RETURNING team_id",
            (f"race-team-{tag}", f"R{tag}"[:10].ljust(10, "X")),
        )
        team_id = cur.fetchone()[0]

        cur.execute(
            """
            INSERT INTO users
                (username, email, password_hash, role, team_id, is_captain)
            VALUES (%s, %s,
                    '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
                    'player', %s, TRUE)
            RETURNING user_id
            """,
            (f"racer-{tag}", f"racer-{tag}@ctfvault.test", team_id),
        )
        user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO challenge_flags (challenge_id, team_id, flag_hash) "
            "VALUES (%s, %s, %s)",
            (challenge_id, team_id, flag_hash(challenge_id, team_id)),
        )
        pairs.append((user_id, team_id))

    cur.close()
    conn.close()
    return challenge_id, pairs


def set_index(enabled: bool):
    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()
    if enabled:
        # The UNSAFE run leaves duplicate first bloods behind, which would
        # block index creation. Repairing them is itself informative: this
        # is the clean-up an operator would face after shipping the race.
        cur.execute(
            """
            UPDATE submissions s
               SET is_first_blood = FALSE
             WHERE s.is_first_blood
               AND s.submission_id <> (
                   SELECT MIN(f.submission_id) FROM submissions f
                    WHERE f.challenge_id = s.challenge_id
                      AND f.is_first_blood)
            """
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_one_first_blood "
            "ON submissions (challenge_id) WHERE is_first_blood"
        )
    else:
        cur.execute("DROP INDEX IF EXISTS uq_one_first_blood")
    cur.close()
    conn.close()


# ---------------------------------------------------------------------
# One racing client. All threads block on the same barrier, so the
# submissions land inside the same few milliseconds.
# ---------------------------------------------------------------------
def racer(barrier, challenge_id, user_id, team_id, results, idx,
          bypass=False):
    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()
    h = flag_hash(challenge_id, team_id)

    barrier.wait()
    t0 = time.perf_counter()
    try:
        if bypass:
            # Simulates a path that does NOT go through fn_submit_flag:
            # a setter repairing data by hand, or a bulk import script.
            # The check and the insert are separate statements with no
            # lock between them — the classic check-then-act race.
            cur.execute(
                "SELECT NOT EXISTS (SELECT 1 FROM submissions "
                " WHERE challenge_id = %s AND is_first_blood)",
                (challenge_id,),
            )
            claim = cur.fetchone()[0]
            cur.execute(
                "INSERT INTO submissions (challenge_id, team_id, user_id, "
                "  submitted_hash, is_correct, is_first_blood) "
                "VALUES (%s, %s, %s, %s, TRUE, %s)",
                (challenge_id, team_id, user_id, h, claim),
            )
            row = (True, True, claim, 0)
        else:
            cur.execute(
                "SELECT accepted, correct, first_blood, points_awarded "
                "FROM fn_submit_flag(%s, %s, %s)",
                (user_id, challenge_id, h),
            )
            row = cur.fetchone()

        results[idx] = {
            "ok": True,
            "first_blood": bool(row[2]),
            "points": row[3],
            "ms": (time.perf_counter() - t0) * 1000,
        }
    except Exception as exc:                       # noqa: BLE001
        results[idx] = {
            "ok": False,
            "first_blood": False,
            "points": 0,
            "ms": (time.perf_counter() - t0) * 1000,
            "error": type(exc).__name__,
            "detail": str(exc).strip().splitlines()[0][:160],
            "sqlstate": getattr(exc, "pgcode", None),
        }
    finally:
        cur.close()
        conn.close()


def cleanup():
    """Drop every fixture row so repeated runs stay fast and comparable."""
    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("DELETE FROM challenges WHERE title LIKE 'RACE-%'")
    cur.execute("DELETE FROM users WHERE username LIKE 'racer-%'")
    cur.execute("DELETE FROM teams WHERE name LIKE 'race-team-%'")
    cur.close()
    conn.close()


def run_round(n_teams, round_no, index_enabled, bypass=False):
    set_index(index_enabled)
    challenge_id, pairs = build_fixture(n_teams, round_no)

    barrier = threading.Barrier(n_teams)
    results = [None] * n_teams
    threads = [
        threading.Thread(
            target=racer,
            args=(barrier, challenge_id, u, t, results, i, bypass),
        )
        for i, (u, t) in enumerate(pairs)
    ]

    t0 = time.perf_counter()
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    wall = (time.perf_counter() - t0) * 1000

    # Ground truth from the database, not from what the clients believed.
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM submissions "
        "WHERE challenge_id = %s AND is_first_blood",
        (challenge_id,),
    )
    db_first_bloods = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM score_ledger "
        "WHERE challenge_id = %s AND entry_type = 'first_blood'",
        (challenge_id,),
    )
    db_bonus_rows = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM submissions "
        "WHERE challenge_id = %s AND is_correct",
        (challenge_id,),
    )
    db_solves = cur.fetchone()[0]
    cur.close()
    conn.close()

    claimed = sum(1 for r in results if r and r["first_blood"])
    errors = sum(1 for r in results if r and not r["ok"])
    lat = [r["ms"] for r in results if r]

    return {
        "challenge_id": challenge_id,
        "clients": n_teams,
        "claimed_first_blood": claimed,
        "db_first_blood_rows": db_first_bloods,
        "db_first_blood_bonuses": db_bonus_rows,
        "db_solves": db_solves,
        "client_errors": errors,
        "wall_ms": round(wall, 1),
        "p50_ms": round(statistics.median(lat), 1) if lat else None,
        "max_ms": round(max(lat), 1) if lat else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--teams", type=int, default=50,
                    help="concurrent clients per round")
    ap.add_argument("--rounds", type=int, default=10)
    ap.add_argument("--json", type=str, default=None,
                    help="write raw results to this path")
    args = ap.parse_args()

    # (label, index present, bypass fn_submit_flag)
    MODES = (
        ("bypass_noindex", False, True),
        ("bypass_index",   True,  True),
        ("guarded",        True,  False),
    )
    TITLES = {
        "bypass_noindex":
            "direct INSERT, index DROPPED   -> race is live",
        "bypass_index":
            "direct INSERT, index PRESENT   -> database rejects the loser",
        "guarded":
            "via fn_submit_flag, index PRESENT -> ordered lock + index",
    }
    report = {m[0]: [] for m in MODES}

    cleanup()

    for mode, enabled, bypass in MODES:
        print(f"\n===  {mode.upper()}  —  {TITLES[mode]}  ===")
        print(f"{'round':>5} {'clients':>8} {'claimed':>8} {'db rows':>8} "
              f"{'bonuses':>8} {'solves':>7} {'wall ms':>8} {'p50 ms':>7}")
        for r in range(1, args.rounds + 1):
            res = run_round(args.teams, r, enabled, bypass)
            report[mode].append(res)
            print(f"{r:>5} {res['clients']:>8} {res['claimed_first_blood']:>8} "
                  f"{res['db_first_blood_rows']:>8} "
                  f"{res['db_first_blood_bonuses']:>8} "
                  f"{res['db_solves']:>7} {res['wall_ms']:>8} "
                  f"{res['p50_ms']:>7}")

    # ----------------------------------------------------------------
    set_index(True)                                 # never leave it off

    def agg(mode, key):
        return [x[key] for x in report[mode]]

    total_requests = args.teams * args.rounds

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    print(f"Clients per round: {args.teams}      "
          f"Rounds: {args.rounds}      "
          f"Requests per mode: {total_requests}")
    print()
    print(f"{'mode':<18} {'bad rounds':>11} {'max FB':>7} {'errors':>8} "
          f"{'p50 ms':>8} {'wall ms':>9}")
    print("-" * 72)
    bad = {}
    for mode, _e, _b in MODES:
        rows = agg(mode, "db_first_blood_rows")
        bad[mode] = sum(1 for v in rows if v != 1)
        print(f"{mode:<18} {bad[mode]:>8}/{args.rounds:<2} "
              f"{max(rows):>7} "
              f"{sum(agg(mode, 'client_errors')):>8} "
              f"{statistics.median(agg(mode, 'p50_ms')):>8.1f} "
              f"{statistics.median(agg(mode, 'wall_ms')):>9.1f}")
    print("-" * 72)
    print("'bad rounds' = rounds whose challenge ended with != 1 first blood.")

    safe_dupes = bad["bypass_index"] + bad["guarded"]

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(report, fh, indent=2)
        print(f"\nRaw results written to {args.json}")

    return 0 if safe_dupes == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
