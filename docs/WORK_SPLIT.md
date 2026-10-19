# CTFVault — Division of Work

**Team (2 members, as required by rubric item 2)**

| | Member | Vertical slice |
|---|---|---|
| **A** | Deeptha Shankar (PES1UG24CS144) | **Scoring & Integrity Core** — relational schema, transactions, triggers, stored procedures, materialised leaderboard, authentication, submission & scoreboard UI |
| **B** | Subhransi | **Knowledge & Retrieval Layer** — pgvector schema, embedding pipeline, chunking, hybrid search, collusion detection, hints economy, writeup & admin UI |

Rubric item 2 requires that *each member contributes to both database and
application development*. The split is therefore **vertical, not
horizontal** — neither person is "the database person" or "the frontend
person". Each slice owns its own tables, its own advanced database
features, its own API routes and its own UI pages.

---

## The seam between the two halves

The two slices meet at exactly three places. Everything else is
independent, so both of us can work without blocking each other.

| Seam | Owner | Contract |
|---|---|---|
| `users`, `teams`, `challenges` tables | A | B reads them by foreign key; B never alters their columns |
| `currentUser()` / `requireRole()` in `app/lib/auth.js` | A | B imports these for every protected route |
| `score_ledger` insert with `entry_type = 'hint_penalty'` | A defines, B writes | B inserts via `CALL sp_unlock_hint(...)` only — never a raw INSERT |

Consequence: **A's migrations are numbered `01`–`06`, B's are `10`–`14`.**
Git history then shows two clean, separable contribution streams, which is
what rubric item 15 asks commits to demonstrate.

---

## Rubric coverage by owner

| # | Requirement | A (Deep) | B (Subhransi) |
|---|---|---|---|
| 3 | Two paradigms | PostgreSQL relational core | pgvector extension |
| 4 | ER diagram + relational schema | Core entities | Vector entities |
| 5 | DDL: CREATE/ALTER/DROP, keys, constraints, indexes, views | ✅ `01`–`02`, `05` | ✅ `10`–`11` |
| 6 | DML + JOIN/GROUP BY/HAVING/subqueries | ✅ views & leaderboard | ✅ hybrid search CTE |
| 7 | ≥4 advanced features | transactions, triggers, procedures, indexing, materialised view | full-text search, vector similarity, HNSW indexing |
| 8 | Vector / semantic search | — | ✅ entire section |
| 9 | Next.js interface | challenge board, submit, scoreboard | search, writeups, hints, admin review |
| 10 | DB–app integration, env vars | ✅ `app/lib/db.js`, `.env.example` | extends `.env.example` with embedding vars |
| 11 | Auth, ≥2 roles | ✅ 3 roles: admin/setter/player | consumes `requireRole` |
| 12 | Validation & integrity at DB level | ✅ CHECKs, guard trigger, audit log | ✅ chunk/embedding constraints |
| 13 | Security | ✅ bcrypt, HMAC salted flags, rate limit | ✅ no raw SQL in search path |
| 14 | Documentation | sections 1–6, 9, 11 | sections 7–8, 10 |
| 15 | Git/GitHub | own commits on `db/0*`, `app/api/{submit,leaderboard,challenges,auth}` | own commits on `db/1*`, `app/api/{search,writeups,hints,admin}` |
| 16 | Demonstration | live scoring + race demo | live semantic search + collusion demo |

---

## Suggested schedule

Three weeks, assuming the ER model and schema (already done) are week 0.

| Week | A (Deep) | B (Subhransi) |
|---|---|---|
| 1 | ✅ schema, triggers, procedures, views, tests | pgvector install, `10`–`11` schema, embedding service stub |
| 2 | auth, submit/leaderboard/challenge routes, concurrency proof, benchmark | chunking pipeline, backfill script, vector search route |
| 3 | challenge board + scoreboard UI, screenshots, report sections | hybrid search + RRF, collusion job, admin panel, retrieval evaluation |

Integration checkpoint at the end of week 2: B's routes must authenticate
through A's `requireRole`, and A's seed script must run B's migrations so
both halves share one database.
