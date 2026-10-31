//PES1UG24CS144_Deeptha
/**
 * GET /api/auth/me — who is signed in (used by the navigation bar)
 * Owner: Deeptha Shankar
 */

import { query } from '../../../lib/db.js';
import { currentUser } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await currentUser();
  if (!session) return Response.json({ user: null });

  const { rows } = await query(
    `SELECT u.user_id, u.username, u.role, u.team_id, t.name AS team_name
       FROM users u
       LEFT JOIN teams t ON t.team_id = u.team_id
      WHERE u.user_id = $1`,
    [session.userId]
  );
  return Response.json({ user: rows[0] ?? null });
}
