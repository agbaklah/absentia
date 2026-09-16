#!/usr/bin/env bash
# Run SQL against the local Supabase database.
# Usage: scripts/sql.sh "select 1;"   or   scripts/sql.sh < file.sql
set -euo pipefail
CONTAINER="supabase_db_uftjspyyihaqvqxemfnc"
if [ $# -gt 0 ]; then
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$1"
else
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1
fi
