-- =====================================================================
-- CTFVault — Demo seed data
-- Owner: Deeptha Shankar
--
-- Every demo account's password_hash is a bcrypt (cost 12) hash of the
-- documented demo password 'demo-password-1'. Only the hash is stored
-- (rubric item 13); change these accounts before any real deployment.
--
-- The flag hashes at the bottom are fixed SHA-256 values used by
-- tests/test_scoring.sql. For a live demo, run `npm run db:flags` after
-- seeding: it replaces them with real per-team HMAC flags (pes{...}) derived
-- from FLAG_SIGNING_SECRET, exactly as app/lib/flags.js issues them.
-- =====================================================================

TRUNCATE audit_log, score_ledger, submissions, challenge_flags,
         challenges, users, teams, categories RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------
INSERT INTO categories (name) VALUES
    ('pwn'), ('web'), ('crypto'), ('forensics'), ('reversing');

-- ---------------------------------------------------------------------
INSERT INTO teams (name, invite_code) VALUES
    ('Segfault',      'INV-AA1001'),
    ('NullPointer',   'INV-BB1002'),
    ('StackSmashers', 'INV-CC1003'),
    ('HeapSpray',     'INV-DD1004'),
    ('ZeroDay',       'INV-EE1005');

-- ---------------------------------------------------------------------
-- One admin, one challenge setter, and two players per team.
INSERT INTO users (username, email, password_hash, role, team_id, is_captain)
VALUES
 ('admin',    'admin@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'admin',  NULL, FALSE),
 ('setter01', 'setter@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'setter', NULL, FALSE),
 ('deep',     'deep@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'player', 1, TRUE),
 ('rhea',     'rhea@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'player', 1, FALSE),
 ('arjun',    'arjun@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'player', 2, TRUE),
 ('meera',    'meera@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'player', 3, TRUE),
 ('kabir',    'kabir@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'player', 4, TRUE),
 ('ishaan',   'ishaan@ctfvault.test',
  '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
  'player', 5, TRUE);

-- ---------------------------------------------------------------------
INSERT INTO challenges
    (title, description, category_id, author_id,
     initial_points, min_points, decay_rate, current_points,
     max_solves, released_at)
VALUES
 ('Heap of Trouble',
  'A use-after-free in a note-taking service. Leak libc, get a shell.',
  1, 2, 500, 100, 4, 500, NULL, now() - INTERVAL '2 hours'),

 ('Cookie Monster',
  'The session cookie is signed. Badly.',
  2, 2, 300, 50, 5, 300, NULL, now() - INTERVAL '2 hours'),

 ('ECB Penguin',
  'Block cipher mode matters. Recover the plaintext.',
  3, 2, 400, 100, 4, 400, 3, now() - INTERVAL '2 hours'),

 ('Carved Up',
  'Recover the deleted partition and find what was hidden there.',
  4, 2, 250, 75, 6, 250, NULL, now() - INTERVAL '1 hour'),

 ('Locked Vault',
  'Not released yet — used to test the release guard.',
  5, 2, 600, 150, 5, 600, NULL, NULL);

-- ---------------------------------------------------------------------
-- Per-team salted flags. Each row is HMAC-SHA256(secret, challenge||team),
-- so the same challenge has a different flag for every team.
INSERT INTO challenge_flags (challenge_id, team_id, flag_hash)
SELECT c.challenge_id,
       t.team_id,
       encode(sha256((c.challenge_id::TEXT || ':' || t.team_id::TEXT
                      || ':demo-salt')::BYTEA), 'hex')
  FROM challenges c
 CROSS JOIN teams t;
