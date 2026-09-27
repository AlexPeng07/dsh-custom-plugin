#!/usr/bin/env bash
#
# Live compatibility check against a RUNNING isolated dsh profile.
#
# This is an opt-in manual probe, not part of CI: it needs a booted dsh web
# server and its own DSH_HOME, which CI has neither reason nor room to create.
# It answers the question `pnpm smoke` cannot — does the built bundle actually
# mount and answer inside a real harness at the version we target?
#
#   DSH_HOME=F:/tmp/dshlive-home DSH_PORT=13587 pnpm build && pnpm pack ...
#   bash scripts/live-dsh-check.sh
#
# Setup it assumes (see README "Local link" for the packaged variant):
#   1. npm i @deepseek-ai/dsh@<version> in a scratch directory (never the
#      developer's global install),
#   2. DSH_HOME pointed at a scratch home, `dsh plugin --profile web add <tgz>`,
#   3. `dsh --profile web --no-open --port <PORT>` running,
#   4. a cookie jar from the boot URL's ?token=... (or leave COOKIE unset and
#      rely on the Origin header, which the same-origin fence also accepts).
#
# Host-half surface only. Slot registration, panel rendering and composer
# insertion still need a browser pass; the script prints what it checked.
# Exits non-zero on any FAIL.
set -u

BASE="http://127.0.0.1:${DSH_PORT:?DSH_PORT=<port>}"
JAR="${COOKIE_JAR:-}"
STATE="${DSH_HOME:?DSH_HOME=<scratch dsh home>}/custom-plugin-state.json"

fails=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; fails=$((fails + 1)); }

req() { # req <method> <path> [body]
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -o - -w "\n%{http_code}" -X "$method" --max-time 30 "$BASE$path"
              -H 'Sec-Fetch-Site: same-origin' -H 'Origin: '"$BASE")
  [ -n "$JAR" ] && args+=(-b "$JAR")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json; charset=utf-8' -d "$body")
  curl "${args[@]}"
}

split() { printf '%s' "${1%$'\n'*}"; }   # body
code() { printf '%s' "${1##*$'\n'}"; }   # status

echo "== dsh live compatibility check: $BASE"

# ── the host half mounted at all ─────────────────────────────────────────────
res=$(req GET /api/custom-plugin/state)
if [ "$(code "$res")" = "200" ] && printf '%s' "$(split "$res")" | grep -q '"ok":true'; then
  pass "state route answers 200 with an ok envelope"
else
  fail "state route did not answer (plugin host half not mounted?)"
fi

res=$(req GET /api/custom-plugin/debug)
mermaid=$(printf '%s' "$(split "$res")" | sed -n 's/.*"mermaidBytes":\([0-9]*\).*/\1/p')
if [ "${mermaid:-0}" -gt 100000 ]; then
  pass "mermaid engine loaded locally ($mermaid bytes)"
else
  fail "mermaid engine bytes = ${mermaid:-none}"
fi

# ── session reads: timeline, export, search scan ─────────────────────────────
sid=$(find "$STATE/../sessions" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | head -1 | xargs -r basename)
if [ -z "$sid" ]; then
  echo "  SKIP  no session under \$DSH_HOME/sessions (create one in the GUI first)"
else
  res=$(req GET "/api/custom-plugin/timeline?sessionId=$sid")
  if printf '%s' "$(split "$res")" | grep -q '"ok":true'; then
    items=$(printf '%s' "$(split "$res")" | grep -o '"seq":' | wc -l)
    pass "timeline reads $sid ($items nodes; readSession/observeSession path works)"
  else
    fail "timeline failed for $sid: $(split "$res" | head -c 160)"
  fi

  for fmt in markdown json pdf; do
    res=$(req POST /api/custom-plugin/export "{\"sessionId\":\"$sid\",\"format\":\"$fmt\"}")
    if printf '%s' "$(split "$res")" | grep -q '"ok":true'; then
      pass "export $fmt built"
    else
      fail "export $fmt failed: $(split "$res" | head -c 160)"
    fi
  done

  # The query is a word from the newest user message, so a hit must come back.
  probe=$(printf '%s' "$(split "$(req GET "/api/custom-plugin/timeline?sessionId=$sid")")" \
          | sed -n 's/.*"text":"\([A-Za-z0-9-]\{6,\}\).*/\1/p' | head -1)
  if [ -n "$probe" ]; then
    res=$(req POST /api/custom-plugin/search "{\"sessionId\":\"$sid\",\"query\":\"$probe\"}")
    body=$(split "$res")
    if printf '%s' "$body" | grep -q '"ok":true'; then
      src=$(printf '%s' "$body" | sed -n 's/.*"source":"\([a-z]*\)".*/\1/p')
      if printf '%s' "$body" | grep -q "\"snippet\":\"[^\"]*$probe"; then
        pass "search ($src) returns a hit whose snippet still contains '$probe'"
      else
        fail "search ($src) returned no snippet containing the query"
      fi
    else
      fail "search failed: $(printf '%s' "$body" | head -c 160)"
    fi
  else
    echo "  SKIP  no ASCII word in the newest user message to search for"
  fi
fi

# ── write paths and the trust fence ──────────────────────────────────────────
res=$(req POST /api/custom-plugin/usage-scan '{}')
printf '%s' "$(split "$res")" | grep -q '"ok":true' && pass "usage scan ran" || fail "usage scan failed"

res=$(req GET /api/custom-plugin/backup)
printf '%s' "$(split "$res")" | grep -q 'dsh-custom-plugin-backup' && pass "backup document exports" || fail "backup failed"

# Non-ASCII must survive the state round trip; a body-decoding regression shows
# up here as U+FFFD in the state file before any UI would notice. The name is
# sent as JSON \u escapes on purpose: a shell here-string is not guaranteed to
# carry UTF-8 bytes (Git Bash hands curl cp936-encoded literals on this
# machine), and a mangled *request* would otherwise be reported as a mangled
# *route*. \uXXXX is pure ASCII on the wire and decodes to the real characters.
res=$(req POST /api/custom-plugin/state '{"prompts":[{"id":"compat-utf8","name":"\u4e2d\u6587\u952e\u540d\u9a8c\u8bc1","text":"probe"}]}')
if [ -f "$STATE" ] && grep -q "$(printf '\xe4\xb8\xad\xe6\x96\x87\xe9\x94\xae\xe5\x90\x8d\xe9\xaa\x8c\xe8\xaf\x81')" "$STATE"; then
  pass "state write keeps UTF-8 names byte-exact"
else
  fail "state write mangled non-ASCII (check body decoding, not the terminal)"
fi
req POST /api/custom-plugin/state '{"prompts":[]}' >/dev/null

fence=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/custom-plugin/state")
[ "$fence" = "403" ] && pass "loopback + same-origin fence rejects an unmarked request" \
                     || fail "fence returned $fence instead of 403"

echo "== host-half probes done; client registration/rendering needs a browser pass"
if [ "$fails" -gt 0 ]; then echo "FAILED: $fails"; exit 1; fi
echo "OK: all live host checks passed"
