import { query, withTransaction } from '../../lib/db.js';
import { requireRole } from '../../lib/auth.js';
import { queueLeaderboardRefresh } from '../../lib/leaderboard.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = await requireRole('player');
  if (user instanceof Response) return user;
  const challengeId = Number(new URL(request.url).searchParams.get('challengeId'));
  if (!Number.isInteger(challengeId) || challengeId <= 0) {
    return Response.json({ error: 'challengeId must be a positive integer.' }, { status: 400 });
  }
  const { rows } = await query(
    `SELECT h.hint_id, h.challenge_id, h.title, h.cost, h.display_order,
            CASE WHEN hu.team_id IS NULL THEN FALSE ELSE TRUE END AS unlocked,
            CASE WHEN hu.team_id IS NULL THEN NULL ELSE h.body END AS body
       FROM hints h
       LEFT JOIN hint_unlocks hu ON hu.hint_id = h.hint_id AND hu.team_id = $2
      WHERE h.challenge_id = $1
      ORDER BY h.display_order`,
    [challengeId, user.teamId]
  );
  return Response.json({ hints: rows });
}

export async function POST(request) {
  const user = await requireRole('player');
  if (user instanceof Response) return user;
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }
  const hintId = Number(body?.hintId);
  if (!Number.isInteger(hintId) || hintId <= 0) {
    return Response.json({ error: 'hintId must be a positive integer.' }, { status: 400 });
  }
  try {
    await withTransaction(user.userId, async (client) => {
      await client.query('CALL sp_unlock_hint($1, $2)', [user.teamId, hintId]);
    });
    // The purchase wrote a hint_penalty row to score_ledger.
    queueLeaderboardRefresh();
    return Response.json({ unlocked: true });
  } catch (error) {
    if (error?.code === '23503') return Response.json({ error: error.message }, { status: 404 });
    console.error('[hints] unlock failed', error);
    return Response.json({ error: 'Hint could not be unlocked.' }, { status: 500 });
  }
}
