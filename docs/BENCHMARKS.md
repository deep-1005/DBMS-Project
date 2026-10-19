# CTFVault — Measured Results

All figures produced on PostgreSQL 16.15, single node, by the scripts in
`tests/`. Reproduce with:

```bash
npm run test:race            # tests/concurrency_test.py
npm run bench:leaderboard    # tests/bench_leaderboard.py
```

---

## 1. First-blood concurrency

**Question.** A challenge must have exactly one first blood. Twenty-five
teams submit a correct flag for the same challenge inside the same few
milliseconds. What stops two of them being crowned?

**Method.** 25 threads, each on its own connection, release from a shared
barrier so their submissions collide. 8 rounds per configuration, a fresh
challenge and 25 fresh teams each round. The first-blood count is read back
from the database afterwards, not taken from what the clients believed.

| Configuration | Bad rounds | Max first bloods in one round | Client errors | p50 latency |
|---|---|---|---|---|
| Direct `INSERT`, `uq_one_first_blood` dropped | **8 / 8** | **25** | 0 | 164 ms |
| Direct `INSERT`, index present | 0 / 8 | 1 | 192 / 200 rejected | 63 ms |
| Via `fn_submit_flag`, index present | **0 / 8** | **1** | **0** | 201 ms |

*Bad round* = a round whose challenge finished with a first-blood count
other than exactly 1.

**Reading the table.**

Row 1 is the bug in its pure form. With no unique index and a
check-then-insert sequence, *every one of the 25 clients* read "nobody has
first blood yet" before any of them had committed, so all 25 were awarded
it. Not an occasional glitch — a complete failure, every round.

Row 2 shows the index doing its job. `uq_one_first_blood` is a partial
unique index on `(challenge_id) WHERE is_first_blood`, so a second
first-blood row is not merely discouraged, it is unrepresentable. The
database rejects 24 of 25 writers. Correct, but 24 users see an error.

Row 3 is the shipped design. `fn_submit_flag` takes the challenge row lock
*before* touching `submissions`, and catches `unique_violation` to retry
the loser as an ordinary solve. All 25 submissions are accepted, all 25
solves are recorded, exactly one first blood is awarded, and nobody sees an
error. Correctness comes from the database; the smooth experience comes
from the function wrapped around it.

### 1.1 A deadlock found by this test

The first version of the scoring path inserted the submission and let the
`AFTER INSERT` trigger take the challenge row lock. That produced two
different lock orders across concurrent transactions:

```
T1:  submissions index entry  ->  challenges row
T2:  challenges row           ->  submissions index entry
```

At 12 concurrent clients, **6 of 8** transactions aborted with SQLSTATE
`40P01`, deadlock detected; at 25 clients, 225 of 250 requests failed and
p50 latency was 9.0 seconds, because every attempt waited out the one
second `deadlock_timeout` before being killed.

The fix was to acquire the challenge lock first, in `fn_submit_flag`, so
every transaction takes locks in one order and the wait-for cycle cannot
form. The trigger keeps its own `FOR NO KEY UPDATE` — matching lock mode —
so a direct `INSERT` is still safe.

| | Before fix | After fix |
|---|---|---|
| Failed requests (25 clients × 10 rounds) | 225 / 250 | **0 / 250** |
| p50 latency | 9 600 ms | **155 ms** |
| Wall time per round | ~20 000 ms | **~340 ms** |
| Solves recorded per round | 1–4 of 25 | **25 of 25** |

This is the finding to raise in the viva: the invariant was never violated
after the fix, but the *first* design was both wrong and 60× slower, and
only a concurrent test revealed it. Running the application single-threaded
would have shown nothing.

---

## 2. Leaderboard: live aggregate vs materialised view

**Question.** `score_ledger` is append-only, so the scoreboard is a
`GROUP BY` over every scoring event ever recorded. Does that scale?

**Method.** Ledger padded to 500 000 rows, `ANALYZE` run, caches warmed,
then 15 timed runs of each query.

| Query | Median | Min | Max |
|---|---|---|---|
| Live aggregate over `score_ledger` | 205.22 ms | 164.19 ms | 347.50 ms |
| Read from `mv_leaderboard` | **0.23 ms** | 0.18 ms | 0.67 ms |

**Median speedup: 898×.**

The cost paid for it:

| Operation | Time |
|---|---|
| `REFRESH MATERIALIZED VIEW` | 244.14 ms |
| `REFRESH MATERIALIZED VIEW CONCURRENTLY` | 204.29 ms |

`CONCURRENTLY` requires the unique index `uq_mv_leaderboard_team`, and
keeps the view readable while it rebuilds — so the scoreboard never blanks
during a refresh. The API debounces refreshes to one every 2 seconds, so a
burst of solves at the start of an event costs one refresh rather than one
per submission.

**The trade-off, stated plainly.** The scoreboard is eventually consistent
with a bounded lag of about 2 seconds. For a CTF that is the right call:
nobody's ranking decision depends on sub-second scoreboard freshness, and
the alternative is a 205 ms aggregate on every page load from every
connected player.

---

## 3. Functional correctness

`tests/test_scoring.sql` — 17 assertions across 8 scenarios, all passing:

| Test | Asserts |
|---|---|
| T1 | A wrong flag is recorded but writes no ledger row |
| T2 | First solver receives full points plus the 10% first-blood bonus (525 on a 500-point challenge) |
| T3 | Second solve decays the challenge to 400 **and** retroactively drops the first solver from 475 to 400 |
| T4 | A team cannot solve the same challenge twice |
| T5 | Exactly one first blood exists after four teams solve |
| T6 | An unreleased challenge rejects submissions at the database level |
| T7 | `max_solves` auto-locks the challenge, and further submissions are refused |
| T8 | Every `mv_leaderboard` total equals the sum of that team's ledger rows |

### 3.1 A tie-break bug found by T8

The leaderboard breaks ties by earliest `last_award_at`, so the team that
reached a total first ranks higher. The first version used `now()` as the
`awarded_at` default — but `now()` is the *transaction* timestamp, so every
row written by one trigger invocation shared it, and two teams on equal
points could not be separated. They tied at rank 2, with nothing at rank 3.

Switching the default to `clock_timestamp()` gives each ledger row a
distinct instant and the tie-break works. Visible in the test output as
ranks 1–5 all distinct instead of `1, 2, 2, 4, 5`.
