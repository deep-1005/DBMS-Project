//PES1UG24CS144_Deeptha
'use client';

/**
 * /team — your team: members, standing and what each member has solved.
 * Owner: Deeptha Shankar
 */

import { useEffect, useState } from 'react';

function when(ts) {
  return new Date(ts).toLocaleString([], {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export default function TeamPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/team', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: 'Could not load your team.' }));
  }, []);

  if (!data) return <main><h1>My team</h1><p className="muted">Loading…</p></main>;
  if (data.error) return <main><h1>My team</h1><p className="muted">{data.error}</p></main>;
  if (!data.team) {
    return (
      <main>
        <h1>My team</h1>
        <p className="muted">
          Your account is not on a team. Admins and setters run the event and
          do not compete.
        </p>
      </main>
    );
  }

  const { team, members, solves } = data;

  return (
    <main>
      <h1>{team.name}</h1>
      <p className="muted">
        Rank {team.rank} · {team.total_points} points · {team.solves} solves ·{' '}
        {team.first_bloods} first bloods · invite code <code>{team.invite_code}</code>
      </p>

      <h2>Members</h2>
      <table>
        <thead>
          <tr><th>Member</th><th className="num">Solves</th><th className="num">Wrong attempts</th></tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.user_id}>
              <td><strong>{m.username}</strong>{m.is_captain && <span className="tag" style={{ marginLeft: ".5rem" }}>captain</span>}</td>
              <td className="num">{m.solves}</td>
              <td className="num">{m.wrong_attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Solved challenges</h2>
      {solves.length === 0 ? (
        <p className="muted">Nothing solved yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Challenge</th><th>Solved by</th><th className="num">Worth now</th><th>When</th></tr>
          </thead>
          <tbody>
            {solves.map((s) => (
              <tr key={s.challenge_id}>
                <td><strong>{s.title}</strong>{s.is_first_blood && <span className="tag" style={{ marginLeft: ".5rem" }}>first blood</span>}</td>
                <td>{s.solved_by}</td>
                <td className="num">{s.current_points}</td>
                <td>{when(s.submitted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
