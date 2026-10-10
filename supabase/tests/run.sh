#!/usr/bin/env bash
#
# Run the database proofs in this directory and decide whether they passed.
#
# These are not pgTAP, despite living in `supabase/tests/`. Each is a single
# `do $$ … $$` block that builds a verdict string and ends with a deliberate
# `raise exception`, so the transaction rolls back and the database is left
# exactly as it was found. `supabase test db` would be the wrong tool: it
# expects pgTAP, and every one of these scripts exits non-zero on success.
#
# **The exit code therefore proves nothing, and neither does the marker.** A
# script that aborted early — a missing table, a renamed function — also exits
# non-zero, and one that reached its raise still reports every individual check
# inside the message. So this reads the verdict:
#
#     ISOLATION >> A-sees-own-org=t(want t); creator-role=owner(want owner); …
#
# and fails when any pair disagrees with what it wanted. A run that produces no
# verdict line at all is a failure too — that is the aborted-early case, and
# treating it as a pass is exactly how a proof becomes decoration.
#
# **Values are not only `t` and `f`.** This matched `=[tf](want [tf])` and
# silently dropped every other pair. Not a cosmetic limit: of the 13 checks in
# tenant-isolation.sql it counted 7, and the 6 it ignored were
# `creator-role=owner` and every cross-tenant *read* — `B-sees-A-org`,
# `B-sees-A-proj`, `B-sees-A-members`. Those are the assertions that file exists
# for, and `B-sees-A-proj=1(want 0)` would still have been reported as
# `ok — 7 check(s)`.
#
# It surfaced only because role-permissions.sql is entirely numeric, so nothing
# in it matched at all and it tripped "verdict line carries no checks" — the
# guard that exists for aborted scripts, doing the job by accident on a script
# that had run perfectly.
#
# Usage: supabase/tests/run.sh <database-url>
set -uo pipefail

db="${1:?usage: supabase/tests/run.sh <database-url>}"
status=0

shopt -s nullglob
for file in supabase/tests/*.sql; do
  echo "── ${file}"
  output="$(psql "$db" -X -q -f "$file" 2>&1 || true)"

  # The prefixes are enumerated, not matched loosely, and adding a spec means
  # adding its name here. That coupling is deliberate but it is also a trap: the
  # loop above globs every *.sql in this directory, so a new file whose prefix
  # is missing produces no verdict and is reported as "did not reach its raise"
  # — a failure that looks like a broken script rather than an unregistered one.
  # If you are reading this because of that message, check here first.
  verdict="$(printf '%s\n' "$output" | grep -oE '(ISOLATION|CLOSER-SUPPRESSION|ROLE-PERMISSIONS|CLI-TOKENS|API-LIMITS|SEED-INTEGRITY|ENTITLEMENTS|MODEL-USAGE|CLOSER-TRACK|CLOSER-ACTIVATION|CLOSER-LOSSES|CLOSER-OPERATORS) >>.*' || true)"
  if [ -z "$verdict" ]; then
    echo "   FAIL — no verdict line: the script did not reach its raise."
    printf '%s\n' "$output" | tail -20 | sed 's/^/   /'
    status=1
    continue
  fi

  # Whole values on both sides, not first characters. The previous version read
  # one character of each, which is right for t/f and wrong for anything longer:
  # `role=member(want owner)` would compare "m" against "o" and only agree by
  # luck, and `count=10(want 1)` would compare "1" against "1" and pass.
  mismatches="$(printf '%s\n' "$verdict" | awk '
    {
      rest = $0
      while (match(rest, /[A-Za-z0-9_-]+=[^()]*\(want [^()]*\)/)) {
        token = substr(rest, RSTART, RLENGTH)
        rest = substr(rest, RSTART + RLENGTH)
        eq = index(token, "=")
        op = index(token, "(want ")
        actual = substr(token, eq + 1, op - eq - 1)
        wanted = substr(token, op + 6, length(token) - op - 6)
        if (actual != wanted) print token
      }
    }')"

  checks="$(printf '%s\n' "$verdict" | grep -oE '[A-Za-z0-9_-]+=[^()]*\(want [^()]*\)' | wc -l)"
  if [ "$checks" -eq 0 ]; then
    echo "   FAIL — verdict line carries no checks: ${verdict}"
    status=1
    continue
  fi

  if [ -n "$mismatches" ]; then
    echo "   FAIL — ${checks} check(s), of which these disagree:"
    printf '%s\n' "$mismatches" | sed 's/^/     /'
    status=1
    continue
  fi

  echo "   ok — ${checks} check(s)"
done

exit "$status"
