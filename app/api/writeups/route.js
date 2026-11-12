import { query, withTransaction } from '../../lib/db.js';
import { requireRole, requireExactRole } from '../../lib/auth.js';
import { chunkText, embedTexts, pgVector } from '../../lib/embeddings.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = await requireRole('player');
  if (user instanceof Response) return user;
  const challengeId = new URL(request.url).searchParams.get('challengeId');
  const { rows } = await query(
    `SELECT w.writeup_id, w.challenge_id, w.team_id, w.title, w.body,
            w.published, w.created_at, t.name AS team_name, c.title AS challenge
       FROM writeups w
       JOIN teams t ON t.team_id = w.team_id
       JOIN challenges c ON c.challenge_id = w.challenge_id
      WHERE w.published
        AND ($1::INTEGER IS NULL OR w.challenge_id = $1)
        AND ($3::BOOLEAN OR EXISTS (
          SELECT 1 FROM submissions s
           WHERE s.challenge_id = w.challenge_id
             AND s.team_id = $2 AND s.is_correct))
      ORDER BY w.created_at DESC`,
    [challengeId ? Number(challengeId) : null, user.teamId, user.role !== 'player']
  );
  return Response.json({ writeups: rows });
}

export async function POST(request) {
  const user = await requireExactRole('player');
  if (user instanceof Response) return user;
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }
  const challengeId = Number(body?.challengeId);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  const published = body?.published !== false;
  if (!Number.isInteger(challengeId) || challengeId <= 0 ||
      title.length < 3 || title.length > 160 || text.length < 80) {
    return Response.json(
      { error: 'challengeId is required; title must be 3–160 characters and body at least 80.' },
      { status: 400 }
    );
  }

  const chunks = chunkText(text);
  let vectors;
  try {
    vectors = await embedTexts(chunks.map((chunk) => chunk.content));
  } catch (error) {
    console.error('[writeups] embedding failed', error);
    return Response.json({ error: 'Writeup could not be embedded.' }, { status: 503 });
  }

  try {
    const writeup = await withTransaction(user.userId, async (client) => {
      const eligible = await client.query(
        `SELECT 1 FROM submissions
          WHERE challenge_id = $1 AND team_id = $2 AND is_correct`,
        [challengeId, user.teamId]
      );
      if (eligible.rowCount === 0) {
        throw Object.assign(new Error('Solve the challenge before publishing a writeup.'), { code: 'NOT_SOLVED' });
      }
      const inserted = await client.query(
        `INSERT INTO writeups (challenge_id, team_id, author_id, title, body, published)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING writeup_id, title, published`,
        [challengeId, user.teamId, user.userId, title, text, published]
      );
      for (let i = 0; i < chunks.length; i += 1) {
        await client.query(
          `INSERT INTO writeup_chunks
             (writeup_id, chunk_index, content, embedding, token_count)
           VALUES ($1, $2, $3, $4::vector, $5)`,
          [inserted.rows[0].writeup_id, i, chunks[i].content, pgVector(vectors[i]), chunks[i].tokenCount]
        );
      }
      return inserted.rows[0];
    });
    return Response.json(writeup, { status: 201 });
  } catch (error) {
    if (error?.code === 'NOT_SOLVED') return Response.json({ error: error.message }, { status: 403 });
    if (error?.code === '23505') return Response.json({ error: 'Your team already has a writeup for this challenge.' }, { status: 409 });
    console.error('[writeups] create failed', error);
    return Response.json({ error: 'Writeup could not be saved.' }, { status: 500 });
  }
}
