import { query, withTransaction } from '../../../lib/db.js';
import { requireRole } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireRole('admin');
  if (user instanceof Response) return user;
  const { rows } = await query(
    `SELECT a.alert_id, a.distance, a.status, a.created_at,
            wa.writeup_id AS writeup_a_id, wa.title AS title_a, wa.body AS body_a,
            ta.name AS team_a, wb.writeup_id AS writeup_b_id,
            wb.title AS title_b, wb.body AS body_b, tb.name AS team_b
       FROM collusion_alerts a
       JOIN writeups wa ON wa.writeup_id = a.writeup_a_id
       JOIN writeups wb ON wb.writeup_id = a.writeup_b_id
       JOIN teams ta ON ta.team_id = wa.team_id
       JOIN teams tb ON tb.team_id = wb.team_id
      WHERE a.status = 'pending'
      ORDER BY a.distance, a.created_at
      LIMIT 100`
  );
  return Response.json({ alerts: rows });
}

export async function POST(request) {
  const user = await requireRole('admin');
  if (user instanceof Response) return user;
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }
  if (body?.action === 'scan') {
    try {
      await query('CALL sp_scan_collusion($1)', [Number(body.threshold ?? 0.05)]);
      return Response.json({ scanned: true });
    } catch (error) {
      console.error('[collusion] scan failed', error);
      return Response.json({ error: 'Collusion scan failed.' }, { status: 500 });
    }
  }
  const alertId = Number(body?.alertId);
  const status = body?.status;
  if (!Number.isInteger(alertId) || !['confirmed', 'dismissed'].includes(status)) {
    return Response.json({ error: 'alertId and a valid review status are required.' }, { status: 400 });
  }
  try {
    await withTransaction(user.userId, async (client) => {
      const result = await client.query(
        `UPDATE collusion_alerts
            SET status = $1, reviewed_by = $2, reviewed_at = now()
          WHERE alert_id = $3 AND status = 'pending'`,
        [status, user.userId, alertId]
      );
      if (result.rowCount === 0) {
        throw Object.assign(new Error('Alert is missing or already reviewed.'), { code: 'NOT_PENDING' });
      }
    });
    return Response.json({ reviewed: true });
  } catch (error) {
    if (error?.code === 'NOT_PENDING') return Response.json({ error: error.message }, { status: 409 });
    console.error('[collusion] review failed', error);
    return Response.json({ error: 'Alert could not be reviewed.' }, { status: 500 });
  }
}
