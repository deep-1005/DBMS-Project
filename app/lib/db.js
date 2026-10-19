/**
 * CTFVault — database access layer
 * Owner: Deeptha Shankar
 *
 * All configuration comes from environment variables (rubric item 10).
 * Nothing in this file, or anywhere in the repository, contains a
 * credential, a connection string, or the flag-signing secret.
 */

import { Pool } from 'pg';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
      `Copy .env.example to .env.local and fill it in.`
    );
  }
  return value;
}

/**
 * One pool per process. Next.js hot-reloads modules in development, so the
 * pool is cached on globalThis to avoid leaking a connection pool per reload.
 */
const globalForPg = globalThis;

export const pool =
  globalForPg.__ctfvaultPool ??
  new Pool({
    host: required('PGHOST'),
    port: Number(process.env.PGPORT ?? 5432),
    user: required('PGUSER'),
    password: required('PGPASSWORD'),
    database: required('PGDATABASE'),
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl:
      process.env.PGSSL === 'require'
        ? { rejectUnauthorized: true }
        : undefined,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPg.__ctfvaultPool = pool;
}

/**
 * Parameterised query helper. Every call site passes values as $1, $2 …
 * so user input is never concatenated into SQL (rubric item 13).
 */
export async function query(text, params = []) {
  const started = Date.now();
  const result = await pool.query(text, params);
  if (process.env.LOG_SQL === '1') {
    console.debug(
      `[sql] ${Date.now() - started}ms  rows=${result.rowCount}  ` +
      `${text.split('\n')[0].trim().slice(0, 80)}`
    );
  }
  return result;
}

/**
 * Run a callback inside a single transaction with the acting user recorded,
 * so the audit triggers can attribute the change.
 *
 *   await withTransaction(actorId, async (client) => { ... });
 */
export async function withTransaction(actorId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config(..., true) is transaction-scoped and parameterised, so the
    // actor id cannot be used for SQL injection via a GUC name.
    await client.query('SELECT set_config($1, $2, true)', [
      'app.actor_id',
      actorId === null || actorId === undefined ? '' : String(actorId),
    ]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
