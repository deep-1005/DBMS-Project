import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>CTFVault</h1>
      <p className="muted">
        A Capture The Flag platform with transaction-safe dynamic scoring and
        semantic search over solution writeups.
      </p>
      <table>
        <tbody>
          <tr><td><Link href="/challenges">Challenges</Link></td>
            <td>Browse challenges, filter by category and submit flags.</td></tr>
          <tr><td><Link href="/scoreboard">Scoreboard</Link></td>
            <td>Live standings with dynamic point decay and first bloods.</td></tr>
          <tr><td><Link href="/writeups">Writeups</Link></td>
            <td>Publish how your team solved a challenge.</td></tr>
          <tr><td><Link href="/search">Search</Link></td>
            <td>Find writeups by technique and meaning, not only exact words.</td></tr>
          <tr><td><Link href="/admin/collusion">Collusion review</Link></td>
            <td>Admins review suspiciously similar writeups across teams.</td></tr>
        </tbody>
      </table>
      <p style={{ marginTop: '1.5rem' }}><Link href="/login">Sign in</Link> to take part.</p>
    </main>
  );
}
