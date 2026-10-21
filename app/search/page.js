'use client';

import { useState } from 'react';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  async function search(event) {
    event.preventDefault();
    setError('');
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const payload = await response.json();
    if (!response.ok) { setError(payload.error ?? 'Search failed.'); return; }
    setResults(payload.results);
  }
  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h1>Semantic writeup search</h1>
      <p>Search by technique and meaning, not only exact words.</p>
      <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="heap overflow with a leaked libc address" style={{ flex: 1, padding: 8 }} />
        <button type="submit">Search</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {results.map((result) => (
        <article key={result.writeup_id} style={{ borderBottom: '1px solid #ddd', padding: '1rem 0' }}>
          <h2>{result.title}</h2>
          <small>{result.challenge} · {result.team_name} · score {result.score}</small>
          <p>{result.snippet}...</p>
        </article>
      ))}
    </main>
  );
}
