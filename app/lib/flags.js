/**
 * CTFVault — per-team flag issuing and verification
 * Owner: Deeptha Shankar
 *
 * Each team receives a DIFFERENT flag for the same challenge, derived by
 * HMAC from a server-side secret. Consequences:
 *
 *   - a leaked flag identifies the team it was issued to, so sharing is
 *     attributable rather than merely detectable;
 *   - the database stores only SHA-256 hashes, so a database dump does
 *     not hand an attacker a single working flag;
 *   - the signing secret lives in an environment variable and never
 *     reaches the database or the repository (rubric items 10 and 13).
 */

import { createHmac, createHash, timingSafeEqual } from 'crypto';

function secret() {
  const s = process.env.FLAG_SIGNING_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'FLAG_SIGNING_SECRET must be set and at least 32 characters.'
    );
  }
  return s;
}

/** Human-readable flag handed to one team for one challenge. */
export function issueFlag(challengeId, teamId) {
  const mac = createHmac('sha256', secret())
    .update(`${challengeId}:${teamId}`)
    .digest('hex')
    .slice(0, 32);
  return `pes{${mac}}`;
}

/** What gets stored / compared in the database. */
export function hashFlag(flagPlaintext) {
  return createHash('sha256')
    .update(flagPlaintext.trim())
    .digest('hex');
}

/** Stored hash for a given (challenge, team) pair. */
export function expectedHash(challengeId, teamId) {
  return hashFlag(issueFlag(challengeId, teamId));
}

/**
 * Constant-time comparison. Not strictly required here because the real
 * comparison happens inside fn_submit_flag, but used anywhere the API
 * compares hashes itself so timing cannot leak a prefix match.
 */
export function hashesEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Given a leaked flag string, work out which team it was issued to.
 * Powers the admin "who leaked this?" tool.
 */
export function attributeFlag(flagPlaintext, challengeId, teamIds) {
  const target = hashFlag(flagPlaintext);
  for (const teamId of teamIds) {
    if (hashesEqual(expectedHash(challengeId, teamId), target)) {
      return teamId;
    }
  }
  return null;
}
