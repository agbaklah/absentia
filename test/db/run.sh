#!/usr/bin/env bash
# Run every DB test (test/db/*.sql except _helpers) against the local stack.
# Each file runs inside BEGIN … ROLLBACK with the shared helpers prepended.
set -uo pipefail
cd "$(dirname "$0")/../.."
fail=0
for f in test/db/*.sql; do
  case "$f" in */_helpers.sql) continue;; esac
  out=$( { echo "BEGIN;"; cat test/db/_helpers.sql; sed -e '/^BEGIN;$/d' -e '/^ROLLBACK;$/d' "$f"; echo "ROLLBACK;"; } \
        | scripts/sql.sh 2>&1 )
  if echo "$out" | grep -q "ALL .* PASSED"; then
    echo "PASS  $f"
  else
    echo "FAIL  $f"; echo "$out" | grep -E "ERROR|CHECK FAILED|EXPECTED|wrong error|NOTICE" | head -20; fail=1
  fi
done
exit $fail
