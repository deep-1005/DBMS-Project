# CTFVault

**A Hybrid Database Platform for Dynamic CTF Scoring and Semantic Search**

DBMS Experiential Learning — Level 3 Project
PES University · Faculty: Dr. Nagasundari S

| Member | Slice |
|---|---|
| Deeptha Shankar (PES1UG24CS144) | Scoring & Integrity Core |
| Epari Subhransi (PES1UG24CS161) | Knowledge & Retrieval Layer |

---

## Problem

Capture The Flag competitions generate two kinds of data that conventional
platforms handle badly.

**Scoring.** Fixed-point scoring rewards volume over difficulty. The fair
alternative — dynamic scoring, where a challenge's value decays as more
teams solve it — is far harder to implement correctly, because every new
solve retroactively changes the score of every team that solved that
challenge earlier. Combined with first-blood bonuses, where concurrent
submissions must resolve to exactly one winner, the leaderboard becomes a
*consistency* problem rather than a storage problem.

**Institutional knowledge.** Every event produces writeups describing how
challenges were solved, but the corpus is unsearchable: a search for
"heap overflow with a leaked libc address" will not surface a writeup
titled "abusing a UAF to leak `__free_hook`", despite describing the same
attack. Keyword search fails because the matching problem is semantic, not
lexical — and the same limitation prevents organisers from detecting
paraphrased plagiarism.

CTFVault treats both as database problems. A relational core handles
competition state where correctness depends on transactional guarantees; a
vector store handles similarity operations relational algebra cannot
express. Each paradigm is used because the data demands it.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router) |
| Backend | Next.js Route Handlers |
| Relational | PostgreSQL 16 |
| Vector | PostgreSQL 16 + pgvector (HNSW, cosine) |
| Auth | bcrypt + signed httpOnly JWT cookies, 3 roles |
| VCS | Git / GitHub |

---

## Setup

### 1. Database

```bash
createdb ctfvault
psql -d ctfvault -f db/01_core_schema.sql
psql -d ctfvault -f db/02_core_indexes.sql
psql -d ctfvault -f db/03_functions_triggers.sql
psql -d ctfvault -f db/04_procedures.sql
psql -d ctfvault -f db/05_views.sql
psql -d ctfvault -f db/10_vector_schema.sql
psql -d ctfvault -f db/11_vector_indexes.sql
psql -d ctfvault -f db/12_hint_procedures.sql
psql -d ctfvault -f db/13_collusion.sql
psql -d ctfvault -f db/06_seed.sql
psql -d ctfvault -f db/14_knowledge_seed.sql
```

Or `npm run db:reset`.

### 2. Environment

```bash
cp .env.example .env.local
openssl rand -hex 32   # -> FLAG_SIGNING_SECRET
openssl rand -hex 32   # -> SESSION_SECRET
```

No credential, connection string or signing secret is committed to this
repository. `.env.local` is gitignored.

Then issue each team its own HMAC-derived flags (the seed only contains the
fixed hashes used by the SQL test suite):

```bash
npm run db:flags                 # issue flags for every team
npm run db:flags -- Segfault     # also print Segfault's flags for a demo
```

### 2a. Extended demo dataset (optional, recommended for the demo)

The small seed has 5 challenges and 5 teams and is what the SQL tests run
against. For a demonstration, load the larger dataset and let the script
play a whole event:

```bash
npm run embed:service    # in a second terminal first (see step 4)
npm run db:reset
npm run db:demo
```

`db:demo` applies `db/07_demo_dataset.sql` (24 challenges in 6 categories,
12 teams, 27 users, 46 hints), issues every team's flags, and then plays
243 submissions, 25 hint purchases and 40 writeups. Nothing is written to
the score ledger directly: every solve goes through `fn_submit_flag`, so
first blood, decay and retroactive adjustments are computed by the
triggers. The run is deterministic. It ends by printing the scoreboard and
the flags of the challenges team Segfault has not solved yet, ready for a
live submission; "QR Quest" is left unsolved by everyone so a first blood
can be shown.

If the embedding service is not running, the writeups are stored without
vectors; start it and run `npm run embed:backfill`, then press "Run
similarity scan" on the admin page.

`db:demo` replaces `db:flags`; do not run both. Run `npm run db:test`
before `db:demo`, not after: the test suite needs the small seed.

### 3. Run

```bash
npm install
npm run dev          # http://localhost:3000
```

**Demo accounts** (all use the password `demo-password-1`, stored only as a
bcrypt hash): `admin` (admin), `setter01` (challenge setter), and players
`deep`, `rhea` (Segfault), `arjun` (NullPointer), `meera` (StackSmashers),
`kabir` (HeapSpray), `ishaan` (ZeroDay). The extended dataset adds
`setter02` and 18 more players across 12 teams (see `db/07_demo_dataset.sql`).

| Page | Who | What it shows |
|---|---|---|
| `/login` | everyone | sign in |
| `/challenges` | players | challenge board, category filter, flag submission |
| `/scoreboard` | everyone | live standings from `mv_leaderboard` |
| `/writeups` | players | publish and read writeups for solved challenges |
| `/search` | players | hybrid semantic + full-text writeup search |
| `/challenges/[id]/hints` | players | buy hints (charged once) |
| `/admin/collusion` | admin | similarity scan and review queue |

### 4. Embeddings

The semantic search uses the local `all-MiniLM-L6-v2` model (384 dimensions),
so writeup content is not sent to a third party. Install the optional Python
dependencies and start the service in a second terminal:

```bash
python -m pip install -r scripts/requirements-embeddings.txt
npm run embed:service
```

The API embeds new writeups transactionally. For imported or interrupted
writeups, run `npm run embed:backfill`; it only updates chunks whose vector
is still null and is safe to repeat.

### 5. Verify

```bash
npm run db:test            # 17 scoring assertions
npm run test:race          # three-mode concurrency proof
npm run bench:leaderboard  # materialised view benchmark
```

---

## Why two database paradigms

Requirement 17 asks the choice to be justified by the data, not included
for demonstration. The justification is specific:

- **Relational, for competition state.** Awarding first blood to exactly
  one of 25 simultaneous submitters requires an atomic read-check-write.
  A partial unique index makes a second first blood *unrepresentable*;
  no document store offers that guarantee.
- **Vector, for the writeup corpus.** Retrieval by meaning is cosine
  distance over 384 dimensions. That operation is not expressible in
  relational algebra — no amount of `JOIN`, `LIKE` or full-text indexing
  produces it.

---

## Advanced database features

| Feature | Where | Owner |
|---|---|---|
| Transactions | `fn_submit_flag` — flag check, insert, scoring, decay in one | A |
| Triggers | `trg_award_solve`, `trg_audit_row`, `trg_guard_submission` | A |
| Stored procedures | `sp_recompute_all_scores`, `sp_issue_team_flag` | A |
| Indexing | 2 partial unique indexes + 10 access-path indexes | A |
| Materialised view | `mv_leaderboard`, refreshed `CONCURRENTLY` | A |
| Views | `v_challenge_board`, `v_team_score_history` | A |
| Full-text search | `tsvector` + GIN on writeups | B |
| Vector similarity | HNSW + cosine on chunk embeddings | B |
| NoSQL-style aggregation | collusion pair scan over embeddings | B |

---

## Headline results

| Measurement | Result |
|---|---|
| First-blood correctness, 25 concurrent solvers | 1 of 25 awarded, 0 client errors, 8/8 rounds |
| Same workload without the partial unique index | **25 of 25** wrongly awarded, 8/8 rounds broken |
| Deadlock fix (lock ordering) | 225/250 failures → **0**, p50 9 600 ms → **155 ms** |
| Leaderboard at 500 000 ledger rows | 205.22 ms → **0.23 ms** (898×) |

Full method and tables in [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md).

---

## Repository layout

```
db/        01-06 core (A), 07 extended demo dataset + demo_writeups.json (A),
           10-14 vector (B)
app/
  lib/     db.js, auth.js, flags.js, leaderboard.js, embeddings.js
  components/ Nav.js (shared navigation)
  login/ challenges/ scoreboard/   pages                 (A)
  api/     submit, leaderboard, challenges, auth   (A)
           search, writeups, hints, admin          (B)
  search/  semantic search page
  writeups/ writeup publishing page
  challenges/[id]/hints/ hint economy page
  admin/collusion/ collusion review page
tests/     test_scoring.sql, concurrency_test.py, bench_leaderboard.py
docs/      WORK_SPLIT.md, BENCHMARKS.md, HANDOVER_SUBHRANSI.md, CTFVault_Project_Report.docx,
           KNOWLEDGE_LAYER.md
           ER diagram + relational schema PDFs
```

---

## Security notes

- Passwords: bcrypt, cost 12. No plaintext anywhere.
- Flags: each team gets a **different** flag per challenge, derived by
  HMAC from a server secret, so a leaked flag identifies the team it was
  issued to. Only SHA-256 hashes reach the database.
- All SQL is parameterised; no string concatenation on any input path.
- Login returns one generic failure message, so the endpoint cannot be
  used to enumerate accounts.
- Wrong submissions are rate limited to 10 per team per minute.
- Every change to `challenges` and `users` is written to `audit_log` by
  trigger, attributed to the acting user via a transaction-scoped GUC.
