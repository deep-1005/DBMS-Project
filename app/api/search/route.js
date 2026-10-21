import { query } from '../../lib/db.js';
import { requireRole } from '../../lib/auth.js';
import { embedTexts, pgVector } from '../../lib/embeddings.js';

export async function GET(request) {
  const user = await requireRole('player');
  if (user instanceof Response) return user;
  const text = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!text || text.length > 500) {
    return Response.json({ error: 'q must be between 1 and 500 characters.' }, { status: 400 });
  }
  let vector;
  try { [vector] = await embedTexts([text]); } catch (error) {
    console.error('[search] embedding failed', error);
    return Response.json({ error: 'Search embedding is unavailable.' }, { status: 503 });
  }
  const { rows } = await query(
    `WITH eligible AS (
       SELECT DISTINCT w.writeup_id
         FROM writeups w
         JOIN submissions s ON s.challenge_id = w.challenge_id
                            AND s.team_id = $2 AND s.is_correct
        WHERE w.published
     ), ranked_chunks AS (
       SELECT wc.writeup_id,
              ROW_NUMBER() OVER (ORDER BY wc.embedding <=> $1::vector) AS rank
         FROM writeup_chunks wc JOIN eligible e USING (writeup_id)
        WHERE wc.embedding IS NOT NULL
        ORDER BY wc.embedding <=> $1::vector
        LIMIT 50
     ), semantic_rank AS (
       SELECT writeup_id, MIN(rank) AS rank
         FROM ranked_chunks
        GROUP BY writeup_id
     ), keyword_rank AS (
       SELECT w.writeup_id,
              ROW_NUMBER() OVER (ORDER BY ts_rank(w.search_vector, q) DESC) AS rank
         FROM writeups w JOIN eligible e USING (writeup_id),
              plainto_tsquery('english', $3) q
        WHERE w.search_vector @@ q
        LIMIT 50
     ), fused AS (
       SELECT COALESCE(s.writeup_id, k.writeup_id) AS writeup_id,
              COALESCE(1.0 / (60 + s.rank), 0) +
              COALESCE(1.0 / (60 + k.rank), 0) AS score
         FROM semantic_rank s FULL OUTER JOIN keyword_rank k USING (writeup_id)
     )
     SELECT f.writeup_id, ROUND(f.score::numeric, 6) AS score,
            w.title, LEFT(w.body, 280) AS snippet,
            c.title AS challenge, t.name AS team_name
       FROM fused f
       JOIN writeups w USING (writeup_id)
       JOIN challenges c USING (challenge_id)
       JOIN teams t USING (team_id)
      ORDER BY f.score DESC, f.writeup_id
      LIMIT 10`,
    [pgVector(vector), user.teamId, text]
  );
  return Response.json({ query: text, results: rows });
}
