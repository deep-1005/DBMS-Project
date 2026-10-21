'use client';

import { useEffect, useState } from 'react';

export default function CollusionPage() {
  const [alerts, setAlerts] = useState([]);
  const [message, setMessage] = useState('');
  async function load() {
    const response = await fetch('/api/admin/collusion');
    const payload = await response.json();
    if (response.ok) setAlerts(payload.alerts);
    else setMessage(payload.error);
  }
  useEffect(() => { load(); }, []);
  async function review(alertId, status) {
    const response = await fetch('/api/admin/collusion', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertId, status }),
    });
    const payload = await response.json();
    setMessage(response.ok ? 'Review saved.' : payload.error);
    if (response.ok) load();
  }
  async function scan() {
    const response = await fetch('/api/admin/collusion', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'scan', threshold: 0.05 }),
    });
    setMessage(response.ok ? 'Similarity scan complete.' : 'Scan failed.');
    load();
  }
  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h1>Collusion review</h1><button onClick={scan}>Run similarity scan</button><p>{message}</p>
      {alerts.map((alert) => <article key={alert.alert_id} style={{ borderBottom: '1px solid #ddd', padding: '1rem 0' }}>
        <strong>Distance: {alert.distance}</strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <section><h2>{alert.title_a} ({alert.team_a})</h2><p>{alert.body_a}</p></section>
          <section><h2>{alert.title_b} ({alert.team_b})</h2><p>{alert.body_b}</p></section>
        </div>
        <button onClick={() => review(alert.alert_id, 'confirmed')}>Confirm</button>{' '}
        <button onClick={() => review(alert.alert_id, 'dismissed')}>Dismiss</button>
      </article>)}
    </main>
  );
}
