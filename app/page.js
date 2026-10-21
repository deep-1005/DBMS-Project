export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>CTFVault</h1>
      <p>Challenge knowledge, semantic retrieval and integrity review.</p>
      <nav style={{ display: 'flex', gap: 16 }}>
        <a href="/search">Search writeups</a>
        <a href="/writeups">Publish writeups</a>
        <a href="/admin/collusion">Admin review</a>
      </nav>
    </main>
  );
}
