/**
 * POST /api/auth/login
 * Owner: Deeptha Shankar
 */

import { verifyCredentials, createSession } from '../../../lib/auth.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !password) {
    return Response.json({ error: 'Username and password are required.' },
      { status: 400 });
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    // One generic message for both "no such user" and "wrong password",
    // so the endpoint cannot be used to enumerate accounts.
    return Response.json({ error: 'Invalid username or password.' },
      { status: 401 });
  }

  await createSession(user);

  return Response.json({
    userId: user.user_id,
    username: user.username,
    role: user.role,
    teamId: user.team_id,
  });
}
