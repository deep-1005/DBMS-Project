--PES1UG24CS144_Deeptha
-- =====================================================================
-- CTFVault — Extended demo dataset
-- Owner: Deeptha Shankar
--
-- Grows the small seed (db/06_seed.sql) into a full event:
--   6 categories, 12 teams, 27 users, 24 challenges, 46 hints.
--
-- Apply AFTER db/06_seed.sql and db/14_knowledge_seed.sql. It is additive
-- and idempotent: every INSERT is keyed on a natural key (name / title /
-- username) and skips rows that already exist, so it can be re-run safely.
-- It deliberately does NOT insert submissions or scores: those must go
-- through fn_submit_flag so the triggers compute decay and first blood.
-- `npm run db:demo` applies this file and then plays the event.
--
-- tests/test_scoring.sql runs against the small seed only; do not apply
-- this file before running it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------
INSERT INTO categories (name) VALUES ('misc')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------
INSERT INTO teams (name, invite_code) VALUES
    ('RootKitKats',       'INV-FF1006'),
    ('ByteBandits',       'INV-GG1007'),
    ('CipherPunks',       'INV-HH1008'),
    ('PacketStorm',       'INV-JJ1009'),
    ('ShellShocked',      'INV-KK1010'),
    ('BitFlippers',       'INV-LL1011'),
    ('OverflowOrchestra', 'INV-MM1012')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------
-- Users. Same documented demo password as the base seed
-- ('demo-password-1'); only its bcrypt hash is stored.
-- ---------------------------------------------------------------------
INSERT INTO users (username, email, password_hash, role, team_id, is_captain)
SELECT v.username, v.username || '@ctfvault.test',
       '$2b$12$ytcflsVNAB66Kx29DxL3aeL18A3HmY7ICV8Hy8yPZbmXtxsxz9ZDC',
       v.role, t.team_id, v.is_captain
  FROM (VALUES
        ('setter02', 'setter', NULL,                FALSE),
        -- second players for the original teams
        ('vikram',   'player', 'NullPointer',       FALSE),
        ('tara',     'player', 'StackSmashers',     FALSE),
        ('rohan',    'player', 'HeapSpray',         FALSE),
        ('nisha',    'player', 'ZeroDay',           FALSE),
        -- new teams
        ('ananya',   'player', 'RootKitKats',       TRUE),
        ('dev',      'player', 'RootKitKats',       FALSE),
        ('sana',     'player', 'ByteBandits',       TRUE),
        ('aditya',   'player', 'ByteBandits',       FALSE),
        ('priya',    'player', 'CipherPunks',       TRUE),
        ('karthik',  'player', 'CipherPunks',       FALSE),
        ('zoya',     'player', 'PacketStorm',       TRUE),
        ('neel',     'player', 'PacketStorm',       FALSE),
        ('ira',      'player', 'ShellShocked',      TRUE),
        ('varun',    'player', 'ShellShocked',      FALSE),
        ('diya',     'player', 'BitFlippers',       TRUE),
        ('sameer',   'player', 'BitFlippers',       FALSE),
        ('lakshmi',  'player', 'OverflowOrchestra', TRUE),
        ('om',       'player', 'OverflowOrchestra', FALSE)
       ) AS v (username, role, team_name, is_captain)
  LEFT JOIN teams t ON t.name = v.team_name
ON CONFLICT (username) DO NOTHING;

-- ---------------------------------------------------------------------
-- Challenges. current_points starts at initial_points; the trigger lowers
-- it as teams solve. decay_rate is the solve count at which the challenge
-- reaches min_points.
-- ---------------------------------------------------------------------
INSERT INTO challenges
    (title, description, category_id, author_id,
     initial_points, min_points, decay_rate, current_points,
     max_solves, released_at)
SELECT v.title, v.description, cat.category_id, u.user_id,
       v.initial_points, v.min_points, v.decay_rate, v.initial_points,
       v.max_solves,
       CASE WHEN v.released THEN now() - INTERVAL '90 minutes' END
  FROM (VALUES
   -- pwn --------------------------------------------------------------
   ('Stack Canary Chirp',
    'A guestbook binary prints your name with printf and then reads a comment into a small stack buffer. The canary is in the way. Get a shell.',
    'pwn', 'setter01', 450, 100, 8, NULL::INTEGER, TRUE),
   ('Return to Sender',
    'The stack is not executable and there is no win function, but libc is right there. Build the chain and read flag.txt.',
    'pwn', 'setter01', 400, 100, 8, NULL, TRUE),
   ('Off By One',
    'A name field copies exactly one byte too many. One byte is enough. Take control of the saved frame pointer.',
    'pwn', 'setter02', 500, 150, 6, NULL, TRUE),

   -- web --------------------------------------------------------------
   ('Union Station',
    'The train timetable search box talks straight to the database. The flag is in a table the timetable never shows.',
    'web', 'setter01', 200, 50, 10, NULL, TRUE),
   ('Template Tantrum',
    'A greeting card generator renders whatever name you give it. The template engine does more than print.',
    'web', 'setter02', 350, 75, 8, NULL, TRUE),
   ('Path Finder',
    'A document viewer loads files by name from an uploads folder. The flag lives one level above it.',
    'web', 'setter01', 150, 50, 10, NULL, TRUE),
   ('Blind Date',
    'The login form never shows an error and never shows data. It does, however, take its time. Extract the admin password hash.',
    'web', 'setter02', 450, 100, 6, NULL, TRUE),

   -- crypto -----------------------------------------------------------
   ('Small E, Big Problem',
    'An RSA message encrypted with public exponent 3 and no padding. The modulus is 2048 bits; the message is short.',
    'crypto', 'setter01', 250, 50, 10, NULL, TRUE),
   ('Two Time Pad',
    'Two ciphertexts, one keystream. You know one of the plaintexts is an English sentence.',
    'crypto', 'setter02', 200, 50, 10, NULL, TRUE),
   ('Oracle of Delphi',
    'The server decrypts AES-CBC cookies and tells you, politely, when the padding is wrong. Decrypt the admin cookie.',
    'crypto', 'setter01', 500, 150, 6, NULL, TRUE),
   ('Hash Extender',
    'Requests are authenticated with sha256(secret || message). Append ''&admin=true'' without knowing the secret.',
    'crypto', 'setter02', 350, 75, 8, 5, TRUE),

   -- forensics --------------------------------------------------------
   ('Packet Whisperer',
    'A capture from a compromised workstation. Nothing obvious left over HTTP, but the DNS traffic is unusually chatty.',
    'forensics', 'setter01', 300, 75, 8, NULL, TRUE),
   ('Memory Lane',
    'A memory image taken while a password manager was unlocked. Find the process and recover the master secret.',
    'forensics', 'setter02', 450, 100, 6, NULL, TRUE),
   ('Exif Marks the Spot',
    'A holiday photo posted by the suspect. Where it was taken is the key to the archive that came with it.',
    'forensics', 'setter01', 100, 50, 12, NULL, TRUE),

   -- reversing --------------------------------------------------------
   ('Crackme Classic',
    'A licence key checker with a single comparison loop. Recover a key that it accepts.',
    'reversing', 'setter01', 150, 50, 12, NULL, TRUE),
   ('Anti-Debug Antics',
    'The binary behaves differently when it is being watched. Make it stop noticing and read the decrypted flag from memory.',
    'reversing', 'setter02', 400, 100, 6, NULL, TRUE),
   ('Matryoshka VM',
    'A custom bytecode interpreter checks the flag one opcode at a time. Write a disassembler, then read the program.',
    'reversing', 'setter02', 550, 150, 5, NULL, TRUE),

   -- misc -------------------------------------------------------------
   ('Git Happens',
    'A repository with a clean working tree and an embarrassing history. Someone committed a key and then removed it.',
    'misc', 'setter01', 100, 50, 12, NULL, TRUE),
   ('QR Quest',
    'A QR code with a torn corner. The error correction can only take you so far; the rest is up to you.',
    'misc', 'setter02', 200, 50, 10, NULL, TRUE)
  ) AS v (title, description, category, author,
          initial_points, min_points, decay_rate, max_solves, released)
  JOIN categories cat ON cat.name = v.category
  JOIN users u        ON u.username = v.author
ON CONFLICT (title) DO NOTHING;

-- ---------------------------------------------------------------------
-- Hints. Every released challenge gets two, ordered from a nudge to a
-- stronger pointer; the second always costs more than the first.
-- (Heap of Trouble and Cookie Monster already have their first hint from
-- db/14_knowledge_seed.sql.)
-- ---------------------------------------------------------------------
INSERT INTO hints (challenge_id, title, body, cost, display_order)
SELECT c.challenge_id, v.title, v.body, v.cost, v.display_order
  FROM (VALUES
   ('Heap of Trouble', 2, 40, 'Where the leak comes from',
    'A freed chunk large enough to skip the tcache holds pointers into the allocator arena. Read it after freeing it.'),
   ('Cookie Monster', 2, 35, 'Which key verifies the token',
    'The server publishes its public key. Consider what happens if the verifier accepts a symmetric algorithm.'),
   ('ECB Penguin', 1, 25, 'Look at repeated blocks',
    'Identical plaintext blocks encrypt to identical ciphertext blocks in this mode. Count them.'),
   ('ECB Penguin', 2, 50, 'Control the alignment',
    'You control a prefix. Pad it so that exactly one unknown byte falls at the end of a block, then compare blocks.'),
   ('Carved Up', 1, 20, 'The partition table is not the data',
    'Deleting a partition only removes its entry. Search the raw image for file system signatures.'),
   ('Carved Up', 2, 35, 'Carve by header',
    'Once the old file system is mounted, the flag is inside a deleted archive. Recover it by its magic bytes.'),

   ('Stack Canary Chirp', 1, 30, 'Two bugs, not one',
    'The name is passed straight to printf. Use it to read values off the stack before you overflow anything.'),
   ('Stack Canary Chirp', 2, 60, 'Find the canary',
    'The canary ends in a null byte and sits just below the saved frame pointer. Leak it, then write it back unchanged.'),
   ('Return to Sender', 1, 30, 'Leak first',
    'Call puts on a GOT entry to learn where libc is loaded, then return to main for a second stage.'),
   ('Return to Sender', 2, 55, 'Mind the alignment',
    'If system crashes inside movaps, the stack is misaligned. Add a single ret gadget before the call.'),
   ('Off By One', 1, 35, 'Which byte is overwritten',
    'The extra byte lands on the lowest byte of the saved frame pointer. Think about what the caller does on return.'),
   ('Off By One', 2, 70, 'Pivot the stack',
    'Zeroing that byte moves the frame down into your buffer. Fill the buffer with a return sled into your chain.'),

   ('Union Station', 1, 15, 'Count the columns',
    'Add ORDER BY with increasing numbers until the query fails. That tells you how many columns to supply.'),
   ('Union Station', 2, 30, 'List the tables',
    'The catalog is queryable like any other table. Ask it for table names, then for the column names of the odd one out.'),
   ('Template Tantrum', 1, 25, 'Is it evaluated?',
    'Submit an arithmetic expression in template delimiters. If the result comes back computed, the input is a template.'),
   ('Template Tantrum', 2, 50, 'Walk the object graph',
    'From any object you can reach its class, then the base class, then every loaded subclass. One of them opens files.'),
   ('Path Finder', 1, 10, 'What does the server join?',
    'The file name is appended to a base directory. Dot-dot segments are still segments.'),
   ('Path Finder', 2, 25, 'The filter runs once',
    'The application strips one traversal sequence and does not repeat. Nest the sequence inside itself.'),
   ('Blind Date', 1, 30, 'Ask yes or no questions',
    'You cannot see the answer, but you can make the database wait when a condition is true.'),
   ('Blind Date', 2, 60, 'Binary search the characters',
    'Compare each character against the middle of the range instead of testing every value. Seven requests per character.'),

   ('Small E, Big Problem', 1, 15, 'How big is m cubed?',
    'If the message is short enough, raising it to the power 3 never wraps around the modulus.'),
   ('Small E, Big Problem', 2, 30, 'Integer roots',
    'Take the exact integer cube root of the ciphertext. Floating point will not be precise enough.'),
   ('Two Time Pad', 1, 15, 'Remove the key',
    'XOR the two ciphertexts together. The keystream cancels and you are left with the two plaintexts combined.'),
   ('Two Time Pad', 2, 30, 'Drag a crib',
    'Slide a likely word such as " the " across the combined text. Where the other plaintext turns readable, you have a match.'),
   ('Oracle of Delphi', 1, 35, 'One byte at a time',
    'Modify the last byte of the previous block until the padding is accepted. That reveals one byte of the intermediate state.'),
   ('Oracle of Delphi', 2, 70, 'Extend the padding',
    'Once a byte is known, set it to produce the next padding value and move one position left. Sixteen bytes per block.'),
   ('Hash Extender', 1, 25, 'The digest is the state',
    'For this hash family the output is the internal state after the last block. You can resume from it.'),
   ('Hash Extender', 2, 50, 'Guess the secret length',
    'You need the original padding, which depends on the secret length. Try each length from 8 to 32.'),

   ('Packet Whisperer', 1, 20, 'Follow the names',
    'Look at the queried host names rather than the answers. The labels are too long and too random to be real hosts.'),
   ('Packet Whisperer', 2, 40, 'Reassemble in order',
    'Each query label carries a sequence number followed by encoded data. Sort, concatenate, and decode.'),
   ('Memory Lane', 1, 30, 'Identify the image first',
    'Determine the operating system profile, then list processes. The password manager is still running.'),
   ('Memory Lane', 2, 60, 'Dump the heap of one process',
    'Dump that process memory and search for the marker string that the application places before the unlocked secret.'),
   ('Exif Marks the Spot', 1, 10, 'Photos carry more than pixels',
    'Read the metadata block of the image. Cameras record where they were.'),
   ('Exif Marks the Spot', 2, 20, 'Format matters',
    'The archive password is the coordinates in decimal degrees to four places, latitude then longitude, comma separated.'),

   ('Crackme Classic', 1, 10, 'Strings first',
    'Look at the strings and the function that references the success message. The check is a short loop.'),
   ('Crackme Classic', 2, 25, 'Invert the transform',
    'Each input character is XORed with its index and compared with a table. XOR the table with the indices.'),
   ('Anti-Debug Antics', 1, 30, 'How does it know?',
    'It asks the operating system whether it is being traced and it measures elapsed time between two points.'),
   ('Anti-Debug Antics', 2, 55, 'Patch, do not fight',
    'Replace the checks with no-ops, or hook the call to return zero. Break after the decrypt routine and read the buffer.'),
   ('Matryoshka VM', 1, 40, 'Find the dispatch loop',
    'There is one large switch inside a loop. Each case is an opcode. Work out the operand sizes first.'),
   ('Matryoshka VM', 2, 80, 'It is a second interpreter',
    'The bytecode itself implements a smaller machine. Lift both layers, then solve the constraints on the input.'),

   ('Git Happens', 1, 10, 'History remembers',
    'Removing a file in a new commit does not remove it from earlier commits. Read the log with patches.'),
   ('Git Happens', 2, 20, 'Not every commit is on a branch',
    'Check the reflog and unreachable objects. The key was committed on a branch that was later deleted.'),
   ('QR Quest', 1, 15, 'Rebuild the finder pattern',
    'All three corner squares are identical. Redraw the missing one and the timing lines next to it.'),
   ('QR Quest', 2, 30, 'Read the format bits',
    'The format information appears twice. Use the intact copy to learn the mask, then decode the data by hand.')
  ) AS v (challenge, display_order, cost, title, body)
  JOIN challenges c ON c.title = v.challenge
ON CONFLICT (challenge_id, display_order) DO NOTHING;
