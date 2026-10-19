/**
 * CTFVault — authentication and role-based authorization
 * Owner: Deeptha Shankar
 *
 * Rubric item 11: three roles — admin, setter, player.
 * Rubric item 13: bcrypt password hashing, signed httpOnly session cookies,
 *                 no credential anywhere in source control.
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { query } from './db.js';

const COOKIE = 'ctfvault_session';
const BCRYPT_ROUNDS = 12;

function sessionKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters.');
  }
  return new TextEncoder().encode(s);
}

/** Role hierarchy: an admin satisfies any requirement below it. */
const RANK = { player: 1, setter: 2, admin: 3 };

export function atLeast(role, required) {
  return (RANK[role] ?? 0) >= (RANK[required] ?? 99);
}

// ---------------------------------------------------------------------
// Registration and login
// ---------------------------------------------------------------------

export async function hashPassword(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length < 10) {
    throw new Error('Password must be at least 10 characters.');
  }
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function registerUser({ username, email, password, teamId }) {
  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (username, email, password_hash, role, team_id)
     VALUES ($1, $2, $3, 'player', $4)
     RETURNING user_id, username, role, team_id`,
    [username, email, passwordHash, teamId ?? null]
  );
  return rows[0];
}

export async function verifyCredentials(username, password) {
  const { rows } = await query(
    `SELECT user_id, username, password_hash, role, team_id
       FROM users WHERE username = $1`,
    [username]
  );

  // Always run a bcrypt comparison, even when the user does not exist, so
  // response time does not reveal which usernames are registered.
  const stored =
    rows[0]?.password_hash ??
    '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';

  const ok = await bcrypt.compare(password, stored);
  if (!ok || rows.length === 0) return null;

  const { password_hash, ...safe } = rows[0];
  return safe;
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

export async function createSession(user) {
  const token = await new SignJWT({
    sub: String(user.user_id),
    role: user.role,
    team: user.team_id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(sessionKey());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Returns { userId, role, teamId } or null. */
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    return {
      userId: Number(payload.sub),
      role: payload.role,
      teamId: payload.team ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Guard for route handlers.
 *
 *   const user = await requireRole('setter');
 *   if (user instanceof Response) return user;
 */
export async function requireRole(required = 'player') {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!atLeast(user.role, required)) {
    return Response.json({ error: 'Insufficient role.' }, { status: 403 });
  }
  return user;
}
