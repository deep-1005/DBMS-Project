//PES1UG24CS144_Deeptha
'use client';

/**
 * Home page. Reads the session so it greets the signed-in user and only
 * lists what that role can actually use.
 * Owner: Deeptha Shankar
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Home() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => setUser(p.user))
      .catch(() => setUser(null));
  }, []);

  const rows = [
    ['/challenges', 'Challenges', 'Browse challenges, filter by category and submit flags.'],
    ['/scoreboard', 'Scoreboard', 'Live standings with dynamic point decay and first bloods.'],
    ['/writeups', 'Writeups', 'Publish how your team solved a challenge.'],
    ['/search', 'Search', 'Find writeups by technique and meaning, not only exact words.'],
  ];
  if (user?.role === 'player') {
    rows.push(['/team', 'My team', 'See your teammates and what each of you has solved.']);
  }
  if (user?.role === 'admin') {
    rows.push(['/admin/collusion', 'Collusion review',
      'Review suspiciously similar writeups across teams.']);
  }

  return (
    <main>
      <h1>CTFVault</h1>
      <p className="muted">
        A Capture The Flag platform with transaction-safe dynamic scoring and
        semantic search over solution writeups.
      </p>
      <table>
        <tbody>
          {rows.map(([href, label, text]) => (
            <tr key={href}>
              <td><Link href={href}>{label}</Link></td>
              <td>{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: '1.5rem' }}>
        {user ? (
          <>Signed in as <strong>{user.username}</strong> ({user.role}
            {user.team_name ? `, team ${user.team_name}` : ''}).</>
        ) : user === null ? (
          <><Link href="/login">Sign in</Link> to take part.</>
        ) : null}
      </p>
    </main>
  );
}
