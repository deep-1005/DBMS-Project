-- Access paths for hybrid retrieval and review queries.
CREATE INDEX ix_writeup_search_vector ON writeups USING GIN (search_vector);
CREATE INDEX ix_writeup_published ON writeups (published, challenge_id);
CREATE INDEX ix_chunk_writeup ON writeup_chunks (writeup_id, chunk_index);
CREATE INDEX ix_chunk_embedding ON writeup_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
CREATE INDEX ix_alert_status ON collusion_alerts (status, created_at);
