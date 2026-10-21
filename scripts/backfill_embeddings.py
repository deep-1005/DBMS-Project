"""Idempotently embed any writeup chunks that do not have vectors."""
import os
import sys

import psycopg
from sentence_transformers import SentenceTransformer


def main() -> int:
    model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    model = SentenceTransformer(model_name)
    connection_string = os.getenv("DATABASE_URL")
    if not connection_string:
        connection_string = (
            f"host={os.getenv('PGHOST', 'localhost')} "
            f"port={os.getenv('PGPORT', '5432')} "
            f"dbname={os.getenv('PGDATABASE', 'ctfvault')} "
            f"user={os.getenv('PGUSER', 'ctfvault')} "
            f"password={os.getenv('PGPASSWORD', '')}"
        )
    with psycopg.connect(connection_string) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT chunk_id, content FROM writeup_chunks "
                "WHERE embedding IS NULL ORDER BY chunk_id"
            )
            rows = cur.fetchall()
            for chunk_id, content in rows:
                vector = model.encode(content, normalize_embeddings=True).tolist()
                cur.execute(
                    "UPDATE writeup_chunks SET embedding = %s::vector "
                    "WHERE chunk_id = %s AND embedding IS NULL",
                    (str(vector).replace(" ", ""), chunk_id),
                )
        conn.commit()
    print(f"Embedded {len(rows)} chunk(s); already indexed chunks were unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
