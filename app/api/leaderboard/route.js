/**
 * GET /api/leaderboard — the scoreboard
 * Owner: Deeptha Shankar
 *
 * Reads the materialized view rather than aggregating score_ledger live.
 * See docs/BENCHMARKS.md for the measured difference at 500k ledger rows.
 */

import { query } from '../../lib/db.js';
import { currentUser } from '../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

  const user = await currentUser();

  const { rows } = await query(
    `SELECT rank, team_id, team_name, total_points,
            solves, first_bloods, last_award_at
       FROM mv_leaderboard
      ORDER BY rank, team_id
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  // A signed-in player also gets their own team's standing, even when it
  // falls outside the requested page.
  let me = null;
  if (user?.teamId) {
    const { rows: mine } = await query(
      `SELECT rank, team_id, team_name, total_points, solves, first_bloods
         FROM mv_leaderboard WHERE team_id = $1`,
      [user.teamId]
    );
    me = mine[0] ?? null;
  }

  const { rows: meta } = await query(
    `SELECT COUNT(*)::INT AS teams,
            (SELECT COUNT(*)::INT FROM score_ledger) AS ledger_entries
       FROM mv_leaderboard`
  );

  return Response.json(
    {
      standings: rows,
      me,
      totalTeams: meta[0].teams,
      ledgerEntries: meta[0].ledger_entries,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
