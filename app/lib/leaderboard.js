//PES1UG24CS144_Deeptha
/**
 * CTFVault — debounced refresh of the mv_leaderboard materialised view
 * Owner: Deeptha Shankar
 *
 * Every route that writes to score_ledger must call this afterwards: flag
 * submissions (app/api/submit) and hint purchases (app/api/hints). A burst
 * of writes costs one REFRESH ... CONCURRENTLY rather than one per write,
 * and CONCURRENTLY keeps the scoreboard readable while it rebuilds.
 */

import { query } from './db.js';

let refreshTimer = null;
let refreshInFlight = false;

export function queueLeaderboardRefresh(delayMs = 2000) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_leaderboard');
    } catch (err) {
      console.error('[leaderboard] refresh failed', err);
    } finally {
      refreshInFlight = false;
    }
  }, delayMs);
}
