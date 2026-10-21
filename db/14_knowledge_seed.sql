-- Safe demo hints. Writeups are created through the embedding pipeline so
-- every stored chunk has a model-generated vector.
INSERT INTO hints (challenge_id, title, body, cost, display_order)
SELECT c.challenge_id, 'Find the memory primitive',
       'Identify where freed objects are reused and determine which allocator metadata can be controlled.',
       25, 1
  FROM challenges c
 WHERE c.title = 'Heap of Trouble'
ON CONFLICT (challenge_id, display_order) DO NOTHING;

INSERT INTO hints (challenge_id, title, body, cost, display_order)
SELECT c.challenge_id, 'Inspect the signing boundary',
       'Trace how the session token is verified and compare the accepted algorithm with the key handling.',
       20, 1
  FROM challenges c
 WHERE c.title = 'Cookie Monster'
ON CONFLICT (challenge_id, display_order) DO NOTHING;
