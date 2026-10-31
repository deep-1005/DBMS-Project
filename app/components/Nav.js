//PES1UG24CS144_Deeptha
'use client';

/**
 * Site navigation. Shows the signed-in user, their role and team, and
 * reveals the admin link only to admins.
 * Owner: Deeptha Shankar
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/challenges', label: 'Challenges' },
  { href: '/scoreboard', label: 'Scoreboard' },
  { href: '/writeups', label: 'Writeups' },
  { href: '/search', label: 'Search' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => setUser(p.user))
      .catch(() => setUser(null));
  }, [pathname]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  }

  const links = user?.role === 'admin'
    ? [...LINKS, { href: '/admin/collusion', label: 'Collusion review' }]
    : LINKS;

  return (
    <header className="topbar">
      <nav className="topbar-inner">
        <Link href="/" className="brand">CTFVault</Link>
        <div className="links">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={pathname.startsWith(l.href) ? 'active' : undefined}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="session">
          {user ? (
            <>
              <span className="who">
                {user.username}
                <span className={`role role-${user.role}`}>{user.role}</span>
                {user.team_name && <span className="team">{user.team_name}</span>}
              </span>
              <button type="button" className="ghost" onClick={logout}>Log out</button>
            </>
          ) : user === null ? (
            <Link href="/login">Log in</Link>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
