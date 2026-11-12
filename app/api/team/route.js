/**
 * GET /api/team — the signed-in player's team: members, standing, solves
 * Owner: Deeptha Shankar
 *
 * Members are listed so a player can see who is on their team and who has
 * contributed which solves. The invite code is only returned to members of
 * that team.
 */

import { query } from '../../lib/db.js';
import { currentUser } from '../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: 'Sign in first.' }, { status: 401 });
  }
  if (!user.teamId) {
    return Response.json({ team: null, members: [], solves: [] });
  }

  const { rows: team } = await query(
    `SELECT t.team_id, t.name, t.invite_code,
            m.rank, m.total_points, m.solves, m.first_bloods
       FROM teams t
       JOIN mv_leaderboard m ON m.team_id = t.team_id
      WHERE t.team_id = $1`,
    [user.teamId]
  );

  const { rows: members } = await query(
    `SELECT u.user_id, u.username, u.is_captain,
            COUNT(s.submission_id) FILTER (WHERE s.is_correct)::INT     AS solves,
            COUNT(s.submission_id) FILTER (WHERE NOT s.is_correct)::INT AS wrong_attempts
       FROM users u
       LEFT JOIN submissions s ON s.user_id = u.user_id
      WHERE u.team_id = $1
      GROUP BY u.user_id, u.username, u.is_captain
      ORDER BY u.is_captain DESC, u.username`,
    [user.teamId]
  );

  const { rows: solves } = await query(
    `SELECT c.challenge_id, c.title, c.current_points,
            u.username AS solved_by, s.submitted_at, s.is_first_blood
       FROM submissions s
       JOIN challenges c ON c.challenge_id = s.challenge_id
       JOIN users u      ON u.user_id = s.user_id
      WHERE s.team_id = $1 AND s.is_correct
      ORDER BY s.submitted_at DESC`,
    [user.teamId]
  );

  return Response.json({ team: team[0] ?? null, members, solves });
}
