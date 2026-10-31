//PES1UG24CS144_Deeptha
/**
 * CTFVault — issue per-team salted flags
 * Owner: Deeptha Shankar
 *
 * Gives every team its own flag for every challenge, derived by HMAC from
 * FLAG_SIGNING_SECRET, and stores only the SHA-256 of each flag through
 * sp_issue_team_flag. Run once after seeding the database:
 *
 *   npm run db:flags                 issue flags for all teams
 *   npm run db:flags -- Segfault     also print Segfault's flags for a demo
 *
 * The derivation must stay identical to issueFlag() / hashFlag() in
 * app/lib/flags.js, which the API uses to verify submissions.
 */

import { createHash, createHmac } from 'node:crypto';
import pg from 'pg';

const secret = process.env.FLAG_SIGNING_SECRET;
if (!secret || secret.length < 32) {
  console.error('FLAG_SIGNING_SECRET must be set (32+ characters) in .env.local');
  process.exit(1);
}

const issueFlag = (challengeId, teamId) =>
  `pes{${createHmac('sha256', secret)
    .update(`${challengeId}:${teamId}`)
    .digest('hex')
    .slice(0, 32)}}`;

const hashFlag = (flag) => createHash('sha256').update(flag.trim()).digest('hex');

const showTeam = process.argv[2] ?? null;
const client = new pg.Client();          // reads PGHOST, PGUSER, ... from env
await client.connect();

try {
  await client.query('BEGIN');
  const { rows: challenges } = await client.query(
    'SELECT challenge_id, title FROM challenges ORDER BY challenge_id');
  const { rows: teams } = await client.query(
    'SELECT team_id, name FROM teams ORDER BY team_id');

  for (const c of challenges) {
    for (const t of teams) {
      await client.query('CALL sp_issue_team_flag($1, $2, $3)',
        [c.challenge_id, t.team_id, hashFlag(issueFlag(c.challenge_id, t.team_id))]);
    }
  }
  await client.query('COMMIT');
  console.log(`Issued ${challenges.length * teams.length} flags ` +
    `(${challenges.length} challenges x ${teams.length} teams).`);

  if (showTeam) {
    const team = teams.find((t) => t.name.toLowerCase() === showTeam.toLowerCase());
    if (!team) {
      console.error(`No team named "${showTeam}".`);
      process.exitCode = 1;
    } else {
      console.log(`\nFlags for ${team.name} (team ${team.team_id}):`);
      for (const c of challenges) {
        console.log(`  ${String(c.challenge_id).padStart(2)}  ${c.title.padEnd(18)} ` +
          issueFlag(c.challenge_id, team.team_id));
      }
    }
  }
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
