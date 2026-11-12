//PES1UG24CS144_Deeptha
'use client';

/**
 * /writeups — publish how your team solved a challenge, and read the
 * writeups you are allowed to see (players: challenges their team solved;
 * admins and setters: all). Publishing embeds the text for semantic search.
 * Owner: Deeptha Shankar
 */

import { useEffect, useState } from 'react';

export default function WriteupsPage() {
  const [role, setRole] = useState(null);
  const [solved, setSolved] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [writeups, setWriteups] = useState([]);
  const [form, setForm] = useState({ challengeId: '', title: '', body: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/writeups', { cache: 'no-store' });
    const payload = await response.json();
    if (response.ok) setWriteups(payload.writeups);
  }

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => setRole(p.user?.role ?? null));
    fetch('/api/team', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => { setSolved(p.solves ?? []); setTeamId(p.team?.team_id ?? null); })
      .catch(() => {});
    load();
  }, []);

  async function publish(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch('/api/writeups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, challengeId: Number(form.challengeId) }),
    });
    const payload = await response.json();
    setBusy(false);
    if (response.ok) {
      setMessage({ kind: 'ok', text: 'Writeup published and indexed for search.' });
      setForm({ challengeId: '', title: '', body: '' });
      load();
    } else {
      setMessage({ kind: 'bad', text: payload.error ?? 'Could not publish.' });
    }
  }

  const isPlayer = role === 'player';

  return (
    <main>
      <h1>Writeups</h1>
      <p className="muted">
        {isPlayer
          ? 'Share how your team solved a challenge. You can read writeups for challenges your team has already solved.'
          : 'Read-only view of every published writeup. Only players publish writeups.'}
      </p>

      {isPlayer && (
        <form className="stack" onSubmit={publish} style={{ maxWidth: 640 }}>
          <select required value={form.challengeId}
            onChange={(e) => setForm({ ...form, challengeId: e.target.value })}>
            <option value="">Choose a challenge your team solved…</option>
            {solved
              .filter((s) => !writeups.some(
                (w) => w.challenge_id === s.challenge_id && w.team_id === teamId))
              .map((s) => (
              <option key={s.challenge_id} value={s.challenge_id}>{s.title}</option>
            ))}
          </select>
          <input required minLength={3} maxLength={160} placeholder="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea required minLength={80} rows={8}
            placeholder="Explain your solution (at least 80 characters)…"
            value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div>
            <button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</button>
          </div>
          {message && <div className={`result ${message.kind}`}>{message.text}</div>}
        </form>
      )}

      <h2 style={{ marginTop: '1.5rem' }}>
        {isPlayer ? 'Writeups you can read' : 'All writeups'} ({writeups.length})
      </h2>
      <table>
        <thead>
          <tr><th>Writeup</th><th>Challenge</th><th>Team</th></tr>
        </thead>
        <tbody>
          {writeups.map((w) => (
            <tr key={w.writeup_id}>
              <td>
                <strong>{w.title}</strong>
                <div className="sub muted">{w.body.length > 260 ? `${w.body.slice(0, 260)}…` : w.body}</div>
              </td>
              <td>{w.challenge}</td>
              <td>{w.team_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
