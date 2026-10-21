'use client';

import { useEffect, useState } from 'react';

export default function WriteupsPage() {
  const [writeups, setWriteups] = useState([]);
  const [form, setForm] = useState({ challengeId: '', title: '', body: '' });
  const [message, setMessage] = useState('');
  async function load() {
    const response = await fetch('/api/writeups');
    const payload = await response.json();
    if (response.ok) setWriteups(payload.writeups);
  }
  useEffect(() => { load(); }, []);
  async function publish(event) {
    event.preventDefault();
    const response = await fetch('/api/writeups', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
    });
    const payload = await response.json();
    setMessage(response.ok ? 'Writeup published.' : payload.error);
    if (response.ok) { setForm({ challengeId: '', title: '', body: '' }); load(); }
  }
  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h1>Writeups</h1>
      <form onSubmit={publish} style={{ display: 'grid', gap: 8, maxWidth: 600 }}>
        <input required type="number" placeholder="Solved challenge ID"
          value={form.challengeId} onChange={(e) => setForm({ ...form, challengeId: e.target.value })} />
        <input required minLength={3} placeholder="Title" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea required minLength={80} rows={8} placeholder="Explain your solution..."
          value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <button type="submit">Publish</button>
      </form>
      <p role="status">{message}</p>
      {writeups.map((writeup) => <article key={writeup.writeup_id}>
        <h2>{writeup.title}</h2><small>{writeup.challenge} · {writeup.team_name}</small><p>{writeup.body}</p>
      </article>)}
    </main>
  );
}
