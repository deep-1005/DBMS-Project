//PES1UG24CS144_Deeptha
/**
 * POST /api/auth/logout
 * Owner: Deeptha Shankar
 */

import { destroySession } from '../../../lib/auth.js';

export async function POST() {
  await destroySession();
  return Response.json({ signedOut: true });
}
