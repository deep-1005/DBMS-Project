# Knowledge and retrieval layer

## Data model

The relational PostgreSQL database remains the source of truth for users,
teams and challenges. `writeups` stores the searchable document and its
ownership, while `writeup_chunks` stores ordered passages and their
`vector(384)` embedding. `hints` and `hint_unlocks` model the hint catalogue
and its many-to-many relationship with teams. `collusion_alerts` stores
deduplicated pairs for administrative review.

Foreign keys and checks enforce ownership, non-empty content, positive hint
costs, vector-pair ordering and valid review states. A trigger maintains the
weighted PostgreSQL full-text vector whenever a title or body changes.

## Embeddings and retrieval

Each writeup is split into approximately 500-word chunks with 50 words of
overlap. The local `sentence-transformers/all-MiniLM-L6-v2` model produces
384-dimensional normalized vectors. They are stored in pgvector and compared
with cosine distance (`<=>`). HNSW (`m=16`, `ef_construction=64`) provides the
vector access path.

Search is hybrid. The API retrieves the top 50 eligible chunks by cosine
distance and the top 50 eligible documents by PostgreSQL full-text rank, then
combines both ranks with Reciprocal Rank Fusion. Results are restricted in SQL
to published writeups for challenges already solved by the requesting team;
unpublished or unsolved knowledge cannot become an accidental hint.

## Hint integrity

`sp_unlock_hint` locks the challenge row, inserts `(team_id, hint_id)` with an
idempotent conflict rule, and records one negative `hint_penalty` ledger event
only when the insert succeeds. A repeated click therefore cannot charge
points twice.

## Collusion review

`sp_scan_collusion` compares embeddings from published writeups belonging to
different teams and stores pairs below the configured cosine-distance
threshold. Pair ordering and a unique constraint prevent mirrored or
duplicate alerts. Administrators can confirm or dismiss each pending alert;
the reviewer and timestamp are retained for auditability. A low distance is a
review signal, not an automatic cheating verdict.

## Demonstration checklist

1. Solve a seeded challenge as a player and publish a writeup.
2. Start the embedding service and search using a paraphrase of its technique.
3. Unlock a hint twice and show one ledger penalty.
4. Publish two similar writeups from different teams, run the admin scan, and
   confirm that one pending alert appears.
5. Explain the ER model, HNSW index, cosine metric, RRF query, transaction,
   trigger, procedure, and role checks during the demonstration.

For retrieval evaluation, hand-label 30 query/writeup pairs and save the
ranked IDs returned by keyword, vector and hybrid retrieval in the JSON shape
accepted by `tests/eval_retrieval.py`. Run:

```bash
python tests/eval_retrieval.py labels.json
```

This deliberately calculates the result from your measured labels rather
than putting invented benchmark numbers in the report.
