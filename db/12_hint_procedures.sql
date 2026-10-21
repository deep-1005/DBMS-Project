-- Hint purchases are ledger events, so they are atomic and auditable.
CREATE OR REPLACE PROCEDURE sp_unlock_hint(p_team_id INTEGER, p_hint_id INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_hint hints%ROWTYPE;
    v_inserted INTEGER;
BEGIN
    SELECT h.* INTO v_hint
      FROM hints h
      JOIN challenges c ON c.challenge_id = h.challenge_id
     WHERE h.hint_id = p_hint_id
     FOR UPDATE OF c;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Hint does not exist' USING ERRCODE = '23503';
    END IF;

    INSERT INTO hint_unlocks (team_id, hint_id)
    VALUES (p_team_id, p_hint_id)
    ON CONFLICT (team_id, hint_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 1 THEN
        INSERT INTO score_ledger
            (team_id, challenge_id, points, entry_type)
        VALUES
            (p_team_id, v_hint.challenge_id, -v_hint.cost, 'hint_penalty');
    END IF;
END;
$$;
