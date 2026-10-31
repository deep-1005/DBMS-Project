/**
 * POST /api/submit — flag submission
 * Owner: Deeptha Shankar
 *
 * The handler deliberately contains NO scoring logic. It authenticates,
 * rate limits, hashes the flag, and delegates to fn_submit_flag, which
 * performs verification, the submission insert, first-blood attribution
 * and retroactive decay inside a single transaction.
 *
 * Keeping scoring in the database is what makes the first-blood invariant
 * hold across multiple application instances: two Next.js servers behind a
 * load balancer cannot both award first blood, because the partial unique
 * index arbitrates, not the process.
 */

import { query, withTransaction } from '../../lib/db.js';
import { requireRole } from '../../lib/auth.js';
import { hashFlag } from '../../lib/flags.js';
import { queueLeaderboardRefresh } from '../../lib/leaderboard.js';

const MAX_WRONG_PER_MINUTE = 10;

export async function POST(request) {
  const user = await requireRole('player');
  if (user instanceof Response) return user;

  // ---- input validation -------------------------------------------
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }

  const challengeId = Number(body?.challengeId);
  const flag = typeof body?.flag === 'string' ? body.flag.trim() : '';

  if (!Number.isInteger(challengeId) || challengeId <= 0) {
    return Response.json({ error: 'challengeId must be a positive integer.' },
      { status: 400 });
  }
  if (flag.length === 0 || flag.length > 200) {
    return Response.json({ error: 'flag must be 1–200 characters.' },
      { status: 400 });
  }

  // ---- rate limit: throttle brute-force guessing --------------------
  const { rows: recent } = await query(
    `SELECT COUNT(*)::INT AS n
       FROM submissions
      WHERE team_id = $1
        AND NOT is_correct
        AND submitted_at > now() - INTERVAL '1 minute'`,
    [user.teamId]
  );

  if (recent[0].n >= MAX_WRONG_PER_MINUTE) {
    return Response.json(
      { error: 'Too many incorrect submissions. Wait a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // ---- delegate to the database ------------------------------------
  try {
    const result = await withTransaction(user.userId, async (client) => {
      const { rows } = await client.query(
        `SELECT accepted, correct, first_blood, points_awarded, message
           FROM fn_submit_flag($1, $2, $3)`,
        [user.userId, challengeId, hashFlag(flag)]
      );
      return rows[0];
    });

    // The leaderboard is a materialized view; refresh it outside the
    // scoring transaction so a slow refresh never holds the submission open.
    if (result.correct && result.accepted) {
      queueLeaderboardRefresh();
    }

    return Response.json(
      {
        accepted: result.accepted,
        correct: result.correct,
        firstBlood: result.first_blood,
        pointsAwarded: result.points_awarded,
        message: result.message,
      },
      { status: result.accepted ? 200 : 409 }
    );
  } catch (err) {
    // Trigger-raised validation (locked / unreleased challenge, wrong team)
    if (err?.code === '23514') {
      return Response.json({ error: err.message }, { status: 403 });
    }
    console.error('[submit] unexpected error', err);
    return Response.json({ error: 'Submission failed.' }, { status: 500 });
  }
}
