#!/usr/bin/env bash
# CTFVault — rebuild the database from scratch.
# Owner: Deeptha Shankar
set -euo pipefail

DB="${PGDATABASE:-ctfvault}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -d "$DB")

echo "Rebuilding $DB"
for f in db/01_core_schema.sql \
         db/02_core_indexes.sql \
         db/03_functions_triggers.sql \
         db/04_procedures.sql \
         db/05_views.sql; do
  echo "  $f"
  "${PSQL[@]}" -f "$f"
done

# Work package B migrations, applied if present.
for f in db/1*.sql; do
  [ -e "$f" ] || continue
  echo "  $f"
  "${PSQL[@]}" -f "$f"
done

echo "  db/06_seed.sql"
"${PSQL[@]}" -f db/06_seed.sql

echo "Done."
