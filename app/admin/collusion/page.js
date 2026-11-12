//PES1UG24CS144_Deeptha
'use client';

/**
 * /admin/collusion — review pairs of writeups from different teams whose
 * embeddings are suspiciously close (cosine distance below the threshold).
 * Owner: Deeptha Shankar
 */

import { useEffect, useState } from 'react';

export default function CollusionPage() {
  const [alerts, setAlerts] = useState([]);
  const [message, setMessage] = useState(null);

  async function load() {
    const response = await fetch('/api/admin/collusion', { cache: 'no-store' });
    const payload = await response.json();
    if (response.ok) setAlerts(payload.alerts);
    else setMessage({ kind: 'bad', text: payload.error });
  }
  useEffect(() => { load(); }, []);

  async function review(alertId, status) {
    const response = await fetch('/api/admin/collusion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertId, status }),
    });
    const payload = await response.json();
    setMessage(response.ok
      ? { kind: 'ok', text: `Alert ${status}.` }
      : { kind: 'bad', text: payload.error });
    if (response.ok) load();
  }

  async function scan() {
    const response = await fetch('/api/admin/collusion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'scan', threshold: 0.05 }),
    });
    setMessage(response.ok
      ? { kind: 'ok', text: 'Similarity scan complete.' }
      : { kind: 'bad', text: 'Scan failed.' });
    load();
  }

  return (
    <main>
      <div className="page-head">
        <h1>Collusion review</h1>
        <button type="button" onClick={scan}>Run similarity scan</button>
      </div>
      <p className="muted">
        Each alert is a pair of writeups from different teams for the same
        challenge whose meaning is almost identical. A smaller distance means
        a closer match.
      </p>
      {message && <div className={`result ${message.kind}`}>{message.text}</div>}

      {alerts.length === 0 && <p className="muted">No open alerts.</p>}

      {alerts.map((a) => (
        <div key={a.alert_id}
          style={{ background: 'var(--surface)', border: '1px solid var(--line)',
                   borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
          <strong>Cosine distance {Number(a.distance).toFixed(4)}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <section>
              <h2>{a.title_a} <span className="tag">{a.team_a}</span></h2>
              <p className="sub">{a.body_a}</p>
            </section>
            <section>
              <h2>{a.title_b} <span className="tag">{a.team_b}</span></h2>
              <p className="sub">{a.body_b}</p>
            </section>
          </div>
          <button type="button" onClick={() => review(a.alert_id, 'confirmed')}>Confirm</button>{' '}
          <button type="button" className="ghost"
            style={{ color: 'var(--text)', borderColor: 'var(--line)' }}
            onClick={() => review(a.alert_id, 'dismissed')}>Dismiss</button>
        </div>
      ))}
    </main>
  );
}
