//PES1UG24CS144_Deeptha
/**
 * CTFVault — load the extended dataset and play a full event
 * Owner: Deeptha Shankar
 *
 *   npm run db:reset      rebuild schema + small seed
 *   npm run db:demo       this script
 *
 * What it does, in order:
 *   1. applies db/07_demo_dataset.sql  (24 challenges, 12 teams, 27 users,
 *      hints for every challenge)
 *   2. issues a per-team HMAC flag for every (challenge, team) pair
 *   3. plays the event: wrong guesses, hint purchases and correct solves,
 *      every one through fn_submit_flag / sp_unlock_hint, so first blood,
 *      point decay, retroactive adjustments and hint penalties are all
 *      computed by the database exactly as they are for a live player
 *   4. publishes the writeups in db/demo_writeups.json, embedding each
 *      one through the embedding service (EMBEDDING_SERVICE_URL)
 *   5. runs the collusion scan and refreshes the leaderboard
 *
 * Nothing is inserted into submissions or score_ledger directly.
 *
 * The event is deterministic (fixed random seed), so every run produces
 * the same scoreboard. "QR Quest" is left unsolved by everyone and team
 * Segfault leaves several challenges open, for a live demo.
 *
 * If the embedding service is not running, writeups are still stored but
 * their chunks have no vector; start the service and run
 * `npm run embed:backfill` to fill them in.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const secret = process.env.FLAG_SIGNING_SECRET;
if (!secret || secret.length < 32) {
  console.error('FLAG_SIGNING_SECRET must be set (32+ characters) in .env.local');
  process.exit(1);
}

// Must stay identical to app/lib/flags.js.
const issueFlag = (challengeId, teamId) =>
  `pes{${createHmac('sha256', secret)
    .update(`${challengeId}:${teamId}`)
    .digest('hex')
    .slice(0, 32)}}`;
const hashFlag = (flag) => createHash('sha256').update(flag.trim()).digest('hex');

// ---- deterministic randomness ---------------------------------------
let rngState = 20261116;
function rand() {                       // mulberry32
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];

// ---- event parameters ------------------------------------------------
// How strong each team is (0..1). Teams not listed solve only the
// challenges they wrote a writeup for.
const SKILL = {
  RootKitKats: 0.82, NullPointer: 0.76, CipherPunks: 0.72, ByteBandits: 0.70,
  StackSmashers: 0.60, PacketStorm: 0.60, ZeroDay: 0.55, HeapSpray: 0.50,
  ShellShocked: 0.45, BitFlippers: 0.40,
};
const UNSOLVED = new Set(['QR Quest']);          // kept for a live first blood
const BRUTE_FORCE = { team: 'OverflowOrchestra', challenge: 'Oracle of Delphi', attempts: 60 };
const HINT_RATE = 0.3;                            // share of solves that buy a hint first

const client = new pg.Client();                  // PGHOST, PGUSER, ... from env
await client.connect();

/** Run fn inside one transaction attributed to a user (as the API does). */
async function asUser(userId, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT set_config($1, $2, true)', ['app.actor_id', String(userId)]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

try {
  // ---- guard: only play the event on a fresh database ----------------
  const { rows: [{ n: existing }] } =
    await client.query('SELECT COUNT(*)::INT AS n FROM submissions');
  if (existing > 0) {
    console.error(`The database already has ${existing} submissions.\n` +
      'Run `npm run db:reset` first, then `npm run db:demo`.');
    process.exit(1);
  }

  // ---- 1. extended dataset --------------------------------------------
  await client.query(await readFile('db/07_demo_dataset.sql', 'utf8'));

  const { rows: challenges } = await client.query(
    `SELECT challenge_id, title, initial_points, max_solves, released_at
       FROM challenges ORDER BY challenge_id`);
  const { rows: teams } = await client.query(
    'SELECT team_id, name FROM teams ORDER BY team_id');
  const { rows: players } = await client.query(
    `SELECT user_id, username, team_id FROM users
      WHERE role = 'player' AND team_id IS NOT NULL ORDER BY user_id`);
  const { rows: hints } = await client.query(
    'SELECT hint_id, challenge_id, display_order FROM hints ORDER BY hint_id');

  const challengeByTitle = new Map(challenges.map((c) => [c.title, c]));
  const teamByName = new Map(teams.map((t) => [t.name, t]));
  const userByName = new Map(players.map((u) => [u.username, u]));
  const membersOf = (teamId) => players.filter((u) => u.team_id === teamId);

  // ---- 2. flags --------------------------------------------------------
  await client.query('BEGIN');
  for (const c of challenges) {
    for (const t of teams) {
      await client.query('CALL sp_issue_team_flag($1, $2, $3)',
        [c.challenge_id, t.team_id, hashFlag(issueFlag(c.challenge_id, t.team_id))]);
    }
  }
  await client.query('COMMIT');

  // ---- 3. plan the event -----------------------------------------------
  const writeups = JSON.parse(await readFile('db/demo_writeups.json', 'utf8'));
  for (const w of writeups) {
    if (!challengeByTitle.has(w.challenge)) throw new Error(`Unknown challenge: ${w.challenge}`);
    if (!userByName.has(w.author)) throw new Error(`Unknown author: ${w.author}`);
  }

  const events = [];                               // { at, kind, ... }
  for (const c of challenges) {
    if (!c.released_at || UNSOLVED.has(c.title)) continue;

    // Teams that published a writeup must have solved the challenge.
    const forced = writeups.filter((w) => w.challenge === c.title)
      .map((w) => userByName.get(w.author));
    const solvers = [...forced];
    for (const t of teams) {
      if (solvers.some((u) => u.team_id === t.team_id)) continue;
      const skill = SKILL[t.name];
      if (skill === undefined) continue;
      const p = Math.min(0.95, Math.max(0.03, skill - c.initial_points / 1000 + 0.15));
      if (rand() < p) solvers.push(pick(membersOf(t.team_id)));
    }
    if (c.max_solves) solvers.length = Math.min(solvers.length, c.max_solves);

    const difficulty = c.initial_points / 600;     // harder = solved later
    for (const user of solvers) {
      const at = difficulty * 0.5 + rand();
      const wrong = rand() < 0.35 ? 1 + Math.floor(rand() * 2) : 0;
      for (let i = 0; i < wrong; i += 1) {
        events.push({ at: at - 0.02 * (wrong - i), kind: 'wrong', user, challenge: c });
      }
      const hint = hints.find((h) => h.challenge_id === c.challenge_id && h.display_order === 1);
      if (hint && c.initial_points >= 250 && rand() < HINT_RATE) {
        events.push({ at: at - 0.01, kind: 'hint', user, challenge: c, hint });
      }
      events.push({ at, kind: 'solve', user, challenge: c });
    }
  }

  // One team hammering a challenge it never solves (feeds
  // v_suspicious_submission_rate).
  {
    const team = teamByName.get(BRUTE_FORCE.team);
    const challenge = challengeByTitle.get(BRUTE_FORCE.challenge);
    for (let i = 0; i < BRUTE_FORCE.attempts; i += 1) {
      events.push({ at: 1.2 + i * 0.001, kind: 'wrong',
        user: pick(membersOf(team.team_id)), challenge });
    }
  }
  events.sort((a, b) => a.at - b.at);

  // ---- play it ---------------------------------------------------------
  const tally = { solve: 0, wrong: 0, hint: 0, firstBlood: 0, rejected: 0 };
  for (const e of events) {
    try {
      if (e.kind === 'hint') {
        await asUser(e.user.user_id, () =>
          client.query('CALL sp_unlock_hint($1, $2)', [e.user.team_id, e.hint.hint_id]));
        tally.hint += 1;
        continue;
      }
      const flag = e.kind === 'solve'
        ? issueFlag(e.challenge.challenge_id, e.user.team_id)
        : `pes{${randomBytes(16).toString('hex')}}`;
      const { rows: [r] } = await asUser(e.user.user_id, () =>
        client.query(
          `SELECT accepted, correct, first_blood FROM fn_submit_flag($1, $2, $3)`,
          [e.user.user_id, e.challenge.challenge_id, hashFlag(flag)]));
      if (r.correct && r.accepted) {
        tally.solve += 1;
        if (r.first_blood) tally.firstBlood += 1;
      } else if (!r.correct) {
        tally.wrong += 1;
      } else {
        tally.rejected += 1;
      }
    } catch (err) {
      // e.g. a guess arriving after the challenge locked at max_solves
      if (err.code !== '23514') throw err;
      tally.rejected += 1;
    }
  }

  // ---- 4. writeups -----------------------------------------------------
  let vectors = null;
  const endpoint = process.env.EMBEDDING_SERVICE_URL;
  if (endpoint) {
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, '')}/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: writeups.map((w) => w.body),
          model: process.env.EMBEDDING_MODEL }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.embeddings?.length !== writeups.length) throw new Error('bad batch');
      vectors = payload.embeddings;
    } catch (err) {
      console.warn(`Embedding service not reachable (${err.cause?.code ?? err.message}).`);
    }
  }

  let published = 0;
  for (let i = 0; i < writeups.length; i += 1) {
    const w = writeups[i];
    const author = userByName.get(w.author);
    const challenge = challengeByTitle.get(w.challenge);
    await asUser(author.user_id, async () => {
      const { rows } = await client.query(
        `INSERT INTO writeups (challenge_id, team_id, author_id, title, body, published)
         SELECT $1, $2, $3, $4, $5, TRUE
          WHERE EXISTS (SELECT 1 FROM submissions s
                         WHERE s.challenge_id = $1 AND s.team_id = $2 AND s.is_correct)
         ON CONFLICT (challenge_id, team_id) DO NOTHING
         RETURNING writeup_id`,
        [challenge.challenge_id, author.team_id, author.user_id, w.title, w.body]);
      if (rows.length === 0) return;
      const words = w.body.trim().split(/\s+/).length;
      await client.query(
        `INSERT INTO writeup_chunks (writeup_id, chunk_index, content, embedding, token_count)
         VALUES ($1, 0, $2, $3::vector, $4)`,
        [rows[0].writeup_id, w.body, vectors ? `[${vectors[i].join(',')}]` : null, words]);
      published += 1;
    });
  }

  // ---- 5. collusion scan + leaderboard ---------------------------------
  if (vectors) await client.query('CALL sp_scan_collusion(0.05)');
  await client.query('REFRESH MATERIALIZED VIEW mv_leaderboard');

  // ---- summary -----------------------------------------------------------
  const count = async (sql) => (await client.query(sql)).rows[0].n;
  console.log('Extended dataset loaded and event played.\n');
  console.log(`  challenges        ${await count('SELECT COUNT(*)::INT n FROM challenges')}`);
  console.log(`  teams             ${await count('SELECT COUNT(*)::INT n FROM teams')}`);
  console.log(`  users             ${await count('SELECT COUNT(*)::INT n FROM users')}`);
  console.log(`  hints             ${await count('SELECT COUNT(*)::INT n FROM hints')}`);
  console.log(`  correct solves    ${tally.solve}  (${tally.firstBlood} first bloods)`);
  console.log(`  wrong guesses     ${tally.wrong}`);
  console.log(`  hints bought      ${tally.hint}`);
  console.log(`  ledger entries    ${await count('SELECT COUNT(*)::INT n FROM score_ledger')}`);
  console.log(`  writeups          ${published}` +
    (vectors ? '  (embedded)' : '  (NOT embedded - start the embedding service, ' +
      'then run: npm run embed:backfill)'));
  console.log(`  collusion alerts  ${await count('SELECT COUNT(*)::INT n FROM collusion_alerts')}`);

  const { rows: top } = await client.query(
    `SELECT t.name, COALESCE(SUM(l.points), 0)::INT AS score
       FROM teams t LEFT JOIN score_ledger l ON l.team_id = t.team_id
      GROUP BY t.team_id, t.name ORDER BY score DESC, t.name LIMIT 5`);
  console.log('\nTop 5:');
  top.forEach((r, i) => console.log(`  ${i + 1}. ${r.name.padEnd(18)} ${r.score}`));

  const segfault = teamByName.get('Segfault');
  const { rows: open } = await client.query(
    `SELECT c.challenge_id, c.title, c.solve_count
       FROM challenges c
      WHERE c.released_at IS NOT NULL AND NOT c.is_locked
        AND NOT EXISTS (SELECT 1 FROM submissions s
                         WHERE s.challenge_id = c.challenge_id
                           AND s.team_id = $1 AND s.is_correct)
      ORDER BY c.solve_count, c.challenge_id`, [segfault.team_id]);
  console.log('\nOpen challenges for a live demo (sign in as deep / demo-password-1):');
  for (const c of open) {
    console.log(`  ${c.title.padEnd(22)} ${String(c.solve_count).padStart(2)} solves  ` +
      issueFlag(c.challenge_id, segfault.team_id));
  }
} finally {
  await client.end();
}
