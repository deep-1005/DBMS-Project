//PES1UG24CS144_Deeptha
'use client';

/**
 * /scoreboard — live standings, read from the mv_leaderboard
 * materialised view. Refreshes every 10 seconds.
 * Owner: Deeptha Shankar
 */

import { useEffect, useState } from 'react';

export default function ScoreboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const response = await fetch('/api/leaderboard', { cache: 'no-store' });
      const payload = await response.json();
      if (alive) setData(payload);
    }
    load();
    const timer = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!data) return <main><h1>Scoreboard</h1><p className="muted">Loading…</p></main>;

  const myTeam = data.me?.team_id;

  return (
    <main>
      <h1>Scoreboard</h1>
      <p className="muted">
        {data.totalTeams} teams · {data.ledgerEntries} score-ledger entries ·
        ties broken by who reached the total first
      </p>
      <table>
        <thead>
          <tr>
            <th className="num">Rank</th><th>Team</th><th className="num">Points</th>
            <th className="num">Solves</th><th className="num">First bloods</th>
            <th>Last scored</th>
          </tr>
        </thead>
        <tbody>
          {data.standings.map((s) => (
            <tr key={s.team_id} className={s.team_id === myTeam ? 'mine' : undefined}>
              <td className="num">{s.rank}</td>
              <td><strong>{s.team_name}</strong>{s.team_id === myTeam && <span className="you">your team</span>}</td>
              <td className="num">{s.total_points}</td>
              <td className="num">{s.solves}</td>
              <td className="num">{s.first_bloods}</td>
              <td>{s.last_award_at ? new Date(s.last_award_at).toLocaleTimeString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
