//PES1UG24CS144_Deeptha
'use client';

/**
 * /search — hybrid semantic search over writeups.
 * The query is embedded (MiniLM, 384 dimensions) and matched against
 * writeup chunks by cosine distance (pgvector HNSW); the same query also
 * runs as PostgreSQL full-text search, and the two rankings are merged
 * with Reciprocal Rank Fusion.
 * Owner: Deeptha Shankar
 */

import { useState } from 'react';

const EXAMPLES = [
  'heap overflow with a leaked libc address',
  'recover a key from deleted history',
  'break a block cipher that reuses its key',
];

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(text) {
    setError('');
    setBusy(true);
    const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`);
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setResults(null);
      setError(payload.error ?? 'Search failed.');
      return;
    }
    setResults(payload.results);
  }

  function submit(event) {
    event.preventDefault();
    if (q.trim()) run(q.trim());
  }

  return (
    <main>
      <h1>Semantic writeup search</h1>
      <p className="muted">
        Search by technique and meaning, not only exact words. Results combine
        vector similarity with keyword matching.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', gap: '.5rem' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }}
          placeholder="heap overflow with a leaked libc address" />
        <button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>

      <p className="sub muted" style={{ marginTop: '.5rem' }}>
        Try:{' '}
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="ghost"
            style={{ color: 'var(--accent)', borderColor: 'var(--line)', marginRight: '.4rem' }}
            onClick={() => { setQ(ex); run(ex); }}>
            {ex}
          </button>
        ))}
      </p>

      {error && <div className="result bad">{error}</div>}

      {results && (
        results.length === 0 ? (
          <p className="muted">No writeups matched.</p>
        ) : (
          <table style={{ marginTop: '1rem' }}>
            <thead>
              <tr><th>Writeup</th><th>Challenge</th><th>Team</th><th className="num">Score</th></tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.writeup_id}>
                  <td>
                    <strong>{r.title}</strong>
                    <div className="sub muted">{r.snippet}…</div>
                  </td>
                  <td>{r.challenge}</td>
                  <td>{r.team_name}</td>
                  <td className="num">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </main>
  );
}
