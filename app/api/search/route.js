
import { query } from '../../lib/db.js';
import { requireRole } from '../../lib/auth.js';
import { embedTexts, pgVector } from '../../lib/embeddings.js';

// Add related cybersecurity terms for keyword retrieval.
function expandKeywordTerms(text) {
  const normalized = text.toLowerCase();
  const extraTerms = new Set();

  // Heap exploitation and memory corruption
  if (
    /\b(heap|tcache|malloc|libc|overflow|unsorted|double.free|use.after.free)\b/.test(normalized)
  ) {
    [
      'tcache',
      'malloc',
      'unsorted',
      'double',
      'free',
      'hook',
      'heap',
      'libc'
    ].forEach(term => extraTerms.add(term));
  }

  // Git history and deleted-file recovery
  if (
    /\b(git|deleted|history|reflog|commit|branch|recover|recovery|key)\b/.test(normalized)
  ) {
    [
      'git',
      'reflog',
      'unreachable',
      'commit',
      'branch',
      'deleted',
      'private',
      'key'
    ].forEach(term => extraTerms.add(term));
  }

  // Block cipher and cryptography attacks
  if (
    /\b(cipher|cryptography|encrypt|encryption|ecb|aes|ciphertext|block)\b/.test(normalized)
  ) {
    [
      'cipher',
      'block',
      'aes',
      'ecb',
      'ciphertext',
      'plaintext',
      'key',
      'mode'
    ].forEach(term => extraTerms.add(term));
  }

  return `${text} ${[...extraTerms].join(' ')}`;
}

export async function GET(request) {
  const user = await requireRole('player');
  if (user instanceof Response) return user;

  const text =
    new URL(request.url).searchParams.get('q')?.trim() ?? '';

  if (!text || text.length > 500) {
    return Response.json(
      { error: 'q must be between 1 and 500 characters.' },
      { status: 400 }
    );
  }

  let vector;

  try {
    [vector] = await embedTexts([text]);
  } catch (error) {
    console.error('[search] embedding failed', error);
    return Response.json(
      { error: 'Search embedding is unavailable.' },
      { status: 503 }
    );
  }

  const keywordText = expandKeywordTerms(text);

  const { rows } = await query(
    `WITH eligible AS (
       SELECT w.writeup_id
         FROM writeups w
        WHERE w.published
          AND (
            $4::BOOLEAN
            OR EXISTS (
              SELECT 1
                FROM submissions s
               WHERE s.challenge_id = w.challenge_id
                 AND s.team_id = $2
                 AND s.is_correct
            )
          )
     ),
     query_terms AS (
       SELECT NULLIF(
         array_to_string(
           tsvector_to_array(to_tsvector('english', $3)),
           ' | '
         ),
         ''
       ) AS terms
     ),
     keyword_query AS (
       SELECT CASE
         WHEN terms IS NOT NULL
         THEN to_tsquery('english', terms)
         ELSE NULL
       END AS tsq
       FROM query_terms
     ),
     ranked_chunks AS (
       SELECT wc.writeup_id,
              ROW_NUMBER() OVER (
                ORDER BY wc.embedding <=> $1::vector,
                         wc.writeup_id
              ) AS rank
         FROM writeup_chunks wc
         JOIN eligible e USING (writeup_id)
        WHERE wc.embedding IS NOT NULL
        ORDER BY wc.embedding <=> $1::vector
        LIMIT 50
     ),
     semantic_rank AS (
       SELECT writeup_id, MIN(rank) AS rank
         FROM ranked_chunks
        GROUP BY writeup_id
     ),
     keyword_rank AS (
       SELECT w.writeup_id,
              ROW_NUMBER() OVER (
                ORDER BY ts_rank(w.search_vector, q.tsq) DESC,
                         w.writeup_id
              ) AS rank
         FROM writeups w
         JOIN eligible e USING (writeup_id)
         CROSS JOIN keyword_query q
        WHERE q.tsq IS NOT NULL
          AND w.search_vector @@ q.tsq
        ORDER BY ts_rank(w.search_vector, q.tsq) DESC
        LIMIT 50
     ),
     fused AS (
       SELECT
         COALESCE(s.writeup_id, k.writeup_id) AS writeup_id,
         COALESCE(2.0 / (60 + s.rank), 0) +
         COALESCE(1.0 / (60 + k.rank), 0) AS score
       FROM semantic_rank s
       FULL OUTER JOIN keyword_rank k USING (writeup_id)
     )
     SELECT f.writeup_id,
            ROUND(f.score::numeric, 6) AS score,
            w.title,
            LEFT(w.body, 280) AS snippet,
            c.title AS challenge,
            t.name AS team_name
       FROM fused f
       JOIN writeups w USING (writeup_id)
       JOIN challenges c USING (challenge_id)
       JOIN teams t USING (team_id)
      ORDER BY f.score DESC, f.writeup_id
      LIMIT 10`,
    [pgVector(vector), user.teamId, keywordText, user.role !== 'player']
  );

  return Response.json({ query: text, results: rows });
}
