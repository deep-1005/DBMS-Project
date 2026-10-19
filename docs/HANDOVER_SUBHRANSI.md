# CTFVault — Work Package B (Subhransi)

## Knowledge & Retrieval Layer

Deep's half (Work Package A) is finished and on `main`: the relational
core, scoring engine, authentication, and the submission / leaderboard /
challenge API routes. Everything below is yours, and nothing in it is
blocked by further work from Deep.

**Read first:** `docs/WORK_SPLIT.md` (the seam between our halves) and
`docs/BENCHMARKS.md` (how we evidence claims — your half needs the
equivalent).

---

## What already exists for you to build on

```
db/01_core_schema.sql        teams, users, challenges, submissions, ledger
db/02_core_indexes.sql       partial unique indexes, access paths
db/03_functions_triggers.sql scoring trigger, audit trigger, guard trigger
db/04_procedures.sql         fn_submit_flag, sp_recompute_all_scores
db/05_views.sql              mv_leaderboard, v_challenge_board
db/06_seed.sql               5 teams, 8 users, 5 challenges, 25 flags
app/lib/db.js                query(), withTransaction(actorId, fn)
app/lib/auth.js              currentUser(), requireRole('admin'|'setter'|'player')
app/api/{submit,leaderboard,challenges,auth}/
tests/test_scoring.sql       17 passing assertions
tests/concurrency_test.py    three-mode race proof
tests/bench_leaderboard.py   898x materialised-view benchmark
```

**Rules of the seam**

1. Do not alter columns in `teams`, `users`, `challenges`, `submissions`,
   or `score_ledger`. Reference them by foreign key.
2. Every protected route starts with
   `const user = await requireRole('player'); if (user instanceof Response) return user;`
3. Never `INSERT` into `score_ledger` directly. Hint purchases go through
   `CALL sp_unlock_hint(...)`, which you write (B4) using
   `entry_type = 'hint_penalty'` — the CHECK constraint already allows it.
4. Your migrations are numbered `10`–`14`; mine are `01`–`06`. This keeps
   our git histories cleanly separable, which rubric item 15 asks for.
5. Use `query()` / `withTransaction()` from `app/lib/db.js`. Always
   parameterised — never string-concatenate SQL.

---

## B1 — pgvector schema `db/10_vector_schema.sql`

Create `WRITEUP`, `WRITEUP_CHUNK`, `HINT`, `HINT_UNLOCK`,
`COLLUSION_ALERT` exactly as drawn in the ER model and relational schema
PDFs already in the repo.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Points to get right:

- `WRITEUP_CHUNK.embedding` is `VECTOR(384)`. The width must match
  `EMBEDDING_DIM` in `.env.example`; if you change the model, change both.
- `WRITEUP.search_vector` is `tsvector`, maintained by a trigger on
  insert/update of `title` and `body` — you need this for B5.
- `UNIQUE (challenge_id, team_id)` on `WRITEUP`: one writeup per team per
  challenge.
- `UNIQUE (writeup_id, chunk_index)` on `WRITEUP_CHUNK`,
  `ON DELETE CASCADE` from `WRITEUP`.
- `COLLUSION_ALERT` needs `CHECK (writeup_a_id < writeup_b_id)` so the
  same pair cannot be stored twice in mirrored order.
- `HINT_UNLOCK` is the M:N resolution: composite primary key
  `(team_id, hint_id)`.

**Done when:** `psql -f db/10_vector_schema.sql` runs clean on a database
that already has `01`–`06` applied, and `\d writeup_chunk` shows the
`vector(384)` column.

---

## B2 — Indexes `db/11_vector_indexes.sql`

```sql
CREATE INDEX ix_chunk_embedding ON writeup_chunk
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX ix_writeup_fts ON writeup USING GIN (search_vector);
```

Run `EXPLAIN ANALYZE` on a vector search with and without the HNSW index
at a few thousand chunks and record both numbers — that table is your
equivalent of my 898× leaderboard result, and it is what makes the
"advanced database features" section evidenced rather than asserted.

**Done when:** `EXPLAIN` shows an Index Scan using `ix_chunk_embedding`,
not a Seq Scan, and you have before/after timings written down.

---

## B3 — Embedding pipeline `app/lib/embeddings.js` + `scripts/backfill_embeddings.py`

1. Split each writeup into ~500-token chunks with ~50 tokens of overlap.
   Store `chunk_index` so order is recoverable.
2. Embed each chunk with `all-MiniLM-L6-v2` (384 dims, runs on CPU, no API
   key needed). Read the model name from `EMBEDDING_MODEL`.
3. Write chunks and vectors in **one transaction per writeup**, so a
   writeup is never half-indexed.
4. Backfill script must be idempotent — safe to re-run after a crash.

Why chunking matters: a 3000-word writeup embedded as a single vector
averages its meaning into mush and the specific technique stops being
findable. Search chunks, return parent writeups, deduplicated.

**Done when:** every published writeup has ≥1 chunk with a non-null
embedding, and re-running the backfill changes nothing.

---

## B4 — Hints economy `db/12_hint_procedures.sql`

```sql
CREATE OR REPLACE PROCEDURE sp_unlock_hint(
    p_team_id INTEGER, p_hint_id INTEGER)
```

Must, in one transaction: check the hint is not already unlocked, insert
`HINT_UNLOCK`, and insert a `score_ledger` row with
`entry_type = 'hint_penalty'` and **negative** points. Use
`ON CONFLICT (team_id, hint_id) DO NOTHING` so a double-click cannot
charge a team twice — same idea as my first-blood index.

Take the `challenges` row lock before writing to `score_ledger`, matching
the ordering in `fn_submit_flag`. If you take locks in a different order
you will reintroduce the deadlock documented in `docs/BENCHMARKS.md` §1.1.

**Done when:** unlocking twice charges once, and the leaderboard total
drops by exactly the hint cost after a refresh.

---

## B5 — Hybrid search `app/api/search/route.js`

Pure vector search is worse than people expect on security text: a query
for `CVE-2021-3156` returns things vaguely about privilege escalation,
because the model does not know that exact string matters. Keyword search
nails it. So run both and fuse with Reciprocal Rank Fusion:

```sql
WITH semantic AS (
  SELECT writeup_id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1) AS rank
    FROM writeup_chunk ORDER BY embedding <=> $1 LIMIT 50
), keyword AS (
  SELECT writeup_id,
         ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, q) DESC) AS rank
    FROM writeup, plainto_tsquery('english', $2) q
   WHERE search_vector @@ q LIMIT 50
)
SELECT COALESCE(s.writeup_id, k.writeup_id) AS writeup_id,
       COALESCE(1.0/(60 + s.rank), 0) + COALESCE(1.0/(60 + k.rank), 0) AS score
  FROM semantic s FULL OUTER JOIN keyword k USING (writeup_id)
 ORDER BY score DESC LIMIT 10;
```

Only published writeups, and only for challenges the requesting team has
already solved — otherwise search becomes a hint vending machine. Enforce
that in the `WHERE` clause, not in JavaScript.

**Done when:** searching "heap overflow with a leaked libc address"
returns a writeup that says "abused a UAF to leak `__free_hook`" and
contains none of the query's words.

---

## B6 — Retrieval evaluation `tests/eval_retrieval.py`

Hand-label 30 query → relevant-writeup pairs. Measure Recall@10 for
keyword-only, vector-only, and hybrid. Produce one table.

This is the single most credible thing either of us will put in the report
— it means you measured instead of asserting. Expect hybrid to win; if it
does not, say so and investigate, because that result is also interesting.

**Done when:** `docs/BENCHMARKS.md` has a section 4 with your three
Recall@10 numbers.

---

## B7 — Collusion detection `db/13_collusion.sql` + `app/api/admin/collusion/route.js`

Same embeddings, pointed sideways. Instead of "which writeups are near my
query", ask "which writeups are near each other but belong to different
teams":

```sql
SELECT a.team_id, b.team_id, a.embedding <=> b.embedding AS distance
  FROM writeup_chunk a
  JOIN writeup_chunk b ON a.writeup_id < b.writeup_id
 WHERE a.embedding <=> b.embedding < 0.05;
```

Insert results into `COLLUSION_ALERT` with `status = 'pending'`. Admin
route (`requireRole('admin')`) lists pending alerts and lets an admin set
`status` to `confirmed` or `dismissed` and stamp `reviewed_by`.

Be careful with the threshold. Two independent writeups of the same easy
challenge are legitimately similar; tune on the seed data and **write down
the false-positive rate you measured**. An alert system with an unstated
threshold is not evidence of anything.

**Done when:** seeding two near-identical writeups from different teams
produces exactly one alert, and two genuinely different writeups produce
none.

---

## B8 — UI pages

| Page | Who sees it | Contents |
|---|---|---|
| `/writeups` | players | list + publish form for solved challenges |
| `/search` | players | search box, ranked results, snippet highlighting |
| `/challenges/[id]/hints` | players | hint list, cost, unlock button with confirm |
| `/admin/collusion` | admin | alert queue, side-by-side writeups, confirm/dismiss |

Match the existing styling in my challenge board and scoreboard pages so
the app reads as one product.

---

## B9 — Report sections

You write: **7** (advanced features — vector side), **8** (vector
database / semantic search, the whole rubric item), **10** (NoSQL/vector
data model, collections, indexes, embeddings, metadata, retrieval
strategy).

I have written: 1–6, 9, 11. Section 8 in particular is graded on
explaining *what* is embedded, *which* model, *how* vectors are stored,
*which* similarity metric, and *how* results are retrieved — answer all
five explicitly.

---

## Suggested order

Two weeks, roughly:

| Days | Tasks |
|---|---|
| 1–2 | B1, B2 — schema and indexes |
| 3–5 | B3 — embedding pipeline and backfill |
| 6–7 | B4 — hints economy |
| 8–10 | B5 — hybrid search |
| 11–12 | B6, B7 — evaluation and collusion |
| 13–14 | B8, B9 — UI and report sections |

**Integration checkpoint after B5.** Run both test suites together against
one database and confirm my 17 scoring assertions still pass with your
tables present. If `sp_unlock_hint` has broken the ledger invariant, T8
will catch it.

---

## Ask me before changing

- Anything in `db/01`–`06` or `app/lib/{db,auth,flags}.js`
- The `score_ledger.entry_type` CHECK constraint
- Lock ordering in any function that writes to `score_ledger`

Anything else is yours to decide.
