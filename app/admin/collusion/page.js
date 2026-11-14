'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'dismissed', label: 'Dismissed' },
];

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString();
}

export default function CollusionPage() {
  const [alerts, setAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/admin/collusion', {
        cache: 'no-store',
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Could not load collusion alerts.');
      }

      setAlerts(Array.isArray(payload.alerts) ? payload.alerts : []);
      setMessage(null);
    } catch (error) {
      setMessage({ kind: 'bad', text: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => ({
    pending: alerts.filter((a) => a.status === 'pending').length,
    confirmed: alerts.filter((a) => a.status === 'confirmed').length,
    dismissed: alerts.filter((a) => a.status === 'dismissed').length,
  }), [alerts]);

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => a.status === activeTab),
    [alerts, activeTab]
  );

  async function review(alertId, status) {
    setProcessingId(alertId);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/collusion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alertId, status }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Could not review alert.');
      }

      setMessage({
        kind: 'ok',
        text: `Alert ${status}.`,
      });

      await load();
    } catch (error) {
      setMessage({ kind: 'bad', text: error.message });
    } finally {
      setProcessingId(null);
    }
  }

  async function scan() {
    setScanning(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/collusion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'scan', threshold: 0.05 }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Similarity scan failed.');
      }

      setMessage({
        kind: 'ok',
        text: 'Similarity scan complete.',
      });

      await load();
      setActiveTab('pending');
    } catch (error) {
      setMessage({ kind: 'bad', text: error.message });
    } finally {
      setScanning(false);
    }
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Collusion review</h1>
          <p className="muted">
            Review suspiciously similar writeups submitted by different teams
            for the same challenge.
          </p>
        </div>

        <button type="button" onClick={scan} disabled={scanning || loading}>
          {scanning ? 'Scanning...' : 'Run similarity scan'}
        </button>
      </div>

      <p className="muted">
        Each alert is a pair of writeups from different teams for the same
        challenge whose meaning is almost identical. A smaller distance means
        a closer match.
      </p>

      {message && (
        <div className={`result ${message.kind}`} role="status">
          {message.text}
        </div>
      )}

      <div
        role="tablist"
        aria-label="Collusion alert status"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          margin: '1.25rem 0',
          borderBottom: '1px solid var(--line)',
          paddingBottom: '0.75rem',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'collusion-tab active' : 'collusion-tab'}
          >
            {tab.label} ({counts[tab.id]})
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading alerts...</p>}

      {!loading && visibleAlerts.length === 0 && (
        <p className="muted">
          {activeTab === 'pending'
            ? 'No open alerts.'
            : `No ${activeTab} alerts yet.`}
        </p>
      )}

      {!loading && visibleAlerts.map((a) => (
        <article
          key={a.alert_id}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '1rem',
            marginTop: '1rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <strong>
              Cosine distance {Number(a.distance).toFixed(4)}
            </strong>
            <span className="tag">
              {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
            </span>
          </div>

          <p className="muted">
            Challenge ID: {a.challenge_id} · Alert #{a.alert_id}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
              gap: '1rem',
            }}
          >
            <section>
              <h2>
                {a.title_a} <span className="tag">{a.team_a}</span>
              </h2>
              <p className="sub">{a.body_a}</p>
            </section>

            <section>
              <h2>
                {a.title_b} <span className="tag">{a.team_b}</span>
              </h2>
              <p className="sub">{a.body_b}</p>
            </section>
          </div>

          {a.status === 'pending' ? (
            <div style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="collusion-confirm"
                disabled={processingId === a.alert_id}
                onClick={() => review(a.alert_id, 'confirmed')}
              >
                {processingId === a.alert_id ? 'Saving...' : 'Confirm'}
              </button>
              {' '}
              <button
                type="button"
                className="collusion-dismiss"
                disabled={processingId === a.alert_id}
                onClick={() => review(a.alert_id, 'dismissed')}
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div
              className="muted"
              style={{
                borderTop: '1px solid var(--line)',
                marginTop: '1rem',
                paddingTop: '0.75rem',
              }}
            >
              <p>Created: {formatDate(a.created_at)}</p>
              <p>Reviewed: {formatDate(a.reviewed_at)}</p>
              <p>Reviewer ID: {a.reviewed_by ?? '—'}</p>
            </div>
          )}
        </article>
      ))}
    </main>
  );
}