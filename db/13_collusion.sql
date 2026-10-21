-- Idempotent similarity scan. Chunks from the same team/challenge are ignored.
CREATE OR REPLACE PROCEDURE sp_scan_collusion(p_threshold REAL DEFAULT 0.05)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO collusion_alerts (writeup_a_id, writeup_b_id, distance)
    SELECT a.writeup_id, b.writeup_id, MIN(a.embedding <=> b.embedding)::REAL
      FROM writeup_chunks a
      JOIN writeup_chunks b ON a.writeup_id < b.writeup_id
      JOIN writeups wa ON wa.writeup_id = a.writeup_id AND wa.published
      JOIN writeups wb ON wb.writeup_id = b.writeup_id AND wb.published
     WHERE a.embedding IS NOT NULL
       AND b.embedding IS NOT NULL
       AND wa.team_id <> wb.team_id
       AND a.embedding <=> b.embedding < p_threshold
     GROUP BY a.writeup_id, b.writeup_id
    ON CONFLICT (writeup_a_id, writeup_b_id) DO UPDATE
      SET distance = EXCLUDED.distance;
END;
$$;
