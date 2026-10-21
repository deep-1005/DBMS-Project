'use client';

import { useEffect, useState } from 'react';

export default function HintsPage({ params }) {
  const [hints, setHints] = useState([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    fetch(`/api/hints?challengeId=${params.id}`).then((r) => r.json())
      .then((payload) => setHints(payload.hints ?? []));
  }, [params.id]);
  async function unlock(hintId) {
    const response = await fetch('/api/hints', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hintId }),
    });
    const payload = await response.json();
    setMessage(response.ok ? 'Hint unlocked; points deducted once.' : payload.error);
    if (response.ok) window.location.reload();
  }
  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h1>Challenge hints</h1><p role="status">{message}</p>
      {hints.map((hint) => <article key={hint.hint_id} style={{ padding: '1rem 0' }}>
        <h2>{hint.display_order}. {hint.title}</h2>
        <p>Cost: {hint.cost} points</p>
        {hint.unlocked ? <p>{hint.body}</p> :
          <button onClick={() => unlock(hint.hint_id)}>Unlock hint</button>}
      </article>)}
    </main>
  );
}
