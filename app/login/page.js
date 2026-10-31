//PES1UG24CS144_Deeptha
'use client';

/**
 * /login — sign in. The API sets an httpOnly, signed session cookie.
 * Owner: Deeptha Shankar
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? 'Sign-in failed.');
      return;
    }
    router.push(payload.role === 'admin' ? '/admin/collusion' : '/challenges');
  }

  return (
    <main className="narrow">
      <h1>Sign in</h1>
      <p className="muted">Players submit flags and publish writeups; admins review
        integrity alerts.</p>
      <form onSubmit={submit} className="stack">
        <label>
          Username
          <input required autoComplete="username" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label>
          Password
          <input required type="password" autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
