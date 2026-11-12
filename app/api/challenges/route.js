/**
 * GET  /api/challenges — the challenge board
 * POST /api/challenges — create a challenge (setter/admin only)
 * Owner: Deeptha Shankar
 */

import { query, withTransaction } from '../../lib/db.js';
import { currentUser, requireRole } from '../../lib/auth.js';
import { expectedHash } from '../../lib/flags.js';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------
export async function GET(request) {
  const user = await currentUser();
  const category = new URL(request.url).searchParams.get('category');

  const { rows } = await query(
    `SELECT b.challenge_id, b.title, b.category, b.current_points,
            b.solve_count, b.is_locked, b.first_blood_team, b.solve_rate_pct,
            (SELECT c.description FROM challenges c
              WHERE c.challenge_id = b.challenge_id) AS description,
            EXISTS (
              SELECT 1 FROM submissions s
               WHERE s.challenge_id = b.challenge_id
                 AND s.team_id = $1
                 AND s.is_correct
            ) AS solved_by_my_team,
            EXISTS (
              SELECT 1 FROM submissions s
               WHERE s.challenge_id = b.challenge_id
                 AND s.user_id = $2
                 AND s.is_correct
            ) AS solved_by_me,
            (SELECT u.username FROM submissions s
               JOIN users u ON u.user_id = s.user_id
              WHERE s.challenge_id = b.challenge_id
                AND s.team_id = $1
                AND s.is_correct
              LIMIT 1) AS team_solver
       FROM v_challenge_board b
      WHERE ($3::TEXT IS NULL OR b.category = $3)
      ORDER BY b.category, b.current_points DESC`,
    [user?.teamId ?? null, user?.userId ?? null, category]
  );

  return Response.json({ challenges: rows });
}

// ---------------------------------------------------------------------
export async function POST(request) {
  const user = await requireRole('setter');
  if (user instanceof Response) return user;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }

  const {
    title, description, categoryId,
    initialPoints, minPoints, decayRate, maxSolves, releaseNow,
  } = body ?? {};

  if (typeof title !== 'string' || title.trim().length < 3) {
    return Response.json({ error: 'title must be at least 3 characters.' },
      { status: 400 });
  }
  if (!Number.isInteger(initialPoints) || !Number.isInteger(minPoints)) {
    return Response.json({ error: 'Point values must be integers.' },
      { status: 400 });
  }
  if (minPoints > initialPoints || minPoints < 1) {
    return Response.json(
      { error: 'minPoints must be between 1 and initialPoints.' },
      { status: 400 });
  }

  try {
    const created = await withTransaction(user.userId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO challenges
             (title, description, category_id, author_id,
              initial_points, min_points, decay_rate, current_points,
              max_solves, released_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $8,
                 CASE WHEN $9 THEN now() ELSE NULL END)
         RETURNING challenge_id, title, current_points`,
        [
          title.trim(), description ?? '', categoryId, user.userId,
          initialPoints, minPoints, decayRate ?? 25,
          maxSolves ?? null, Boolean(releaseNow),
        ]
      );
      const challenge = rows[0];

      // Issue one salted flag per existing team, in the same transaction,
      // so a released challenge is never visible without flags.
      const { rows: teams } = await client.query(
        'SELECT team_id FROM teams'
      );
      for (const { team_id } of teams) {
        await client.query(
          'CALL sp_issue_team_flag($1, $2, $3)',
          [challenge.challenge_id, team_id,
           expectedHash(challenge.challenge_id, team_id)]
        );
      }

      return { ...challenge, flagsIssued: teams.length };
    });

    return Response.json(created, { status: 201 });
  } catch (err) {
    if (err?.code === '23505') {
      return Response.json({ error: 'A challenge with that title exists.' },
        { status: 409 });
    }
    if (err?.code === '23514') {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error('[challenges] create failed', err);
    return Response.json({ error: 'Could not create challenge.' },
      { status: 500 });
  }
}
