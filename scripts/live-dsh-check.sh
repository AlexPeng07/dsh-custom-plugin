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

# This probe WRITES: the UTF-8 round trip appends an entry to the prompt library
# (it restores afterwards and verifies the restore) and the usage scan rewrites
# today's ledger. Refuse to touch a developer's own harness home unless they say
# so. Normalize separators before matching: a Windows DSH_HOME arrives with
# backslashes, and a pattern using `/` would never match it — a guard that
# silently never fires is worse than no guard.
norm=${STATE//\\//}
case "$norm" in
  */.dsh/custom-plugin-state.json)
    if [ "${ALLOW_REAL_DSH_HOME:-0}" != "1" ]; then
      echo "REFUSING: DSH_HOME looks like a real harness home ($STATE)."
      echo "Point it at a scratch profile, or set ALLOW_REAL_DSH_HOME=1 to proceed."
      exit 2
    fi ;;
esac
echo "== dsh live compatibility check: http://127.0.0.1:${DSH_PORT}   state: $STATE"

fails=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; fails=$((fails + 1)); }

req() { # req <method> <path> [body | @file]
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -o - -w "\n%{http_code}" -X "$method" --max-time 30 "$BASE$path"
              -H 'Sec-Fetch-Site: same-origin' -H 'Origin: '"$BASE")
  [ -n "$JAR" ] && args+=(-b "$JAR")
  # --data-binary, and bodies that carry user data are passed as @file: on
  # Windows, Git Bash re-encodes non-ASCII argv for curl.exe, which silently
  # turned a captured CJK prompt into U+FFFD on the way back.
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json; charset=utf-8' --data-binary "$body")
  curl "${args[@]}"
}

split() { printf '%s' "${1%$'\n'*}"; }   # body
code() { printf '%s' "${1##*$'\n'}"; }   # status


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

  # The query comes from the newest user message, so a hit must come back.
  # Parsed with node rather than a hand-rolled regex: an early draft grabbed
  # field and needed 6 consecutive word chars, so a message starting with a
  # 5-letter word silently SKIPped the only probe that covers the scan path.
  probe=$(req GET "/api/custom-plugin/timeline?sessionId=$sid" | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
  try {
    const body = JSON.parse(s.slice(0, s.lastIndexOf("\n")))
    const items = body.items ?? []
    const words = (items[items.length - 1]?.text ?? "").split(/[^A-Za-z0-9]+/).filter(w => w.length >= 3)
    process.stdout.write(words.sort((a, b) => b.length - a.length)[0] ?? "")
  } catch { process.stdout.write("") }
})')
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

# The Mermaid engine is served on its own non-API path, so it needs its own
# probe — size only: a 3.5 MB body must not land in a shell variable.
cookie_args=()
[ -n "$JAR" ] && cookie_args=(-b "$JAR")
mm=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "${cookie_args[@]}" \
        -H 'Sec-Fetch-Site: same-origin' -H 'Origin: '"$BASE" --max-time 60 \
        "$BASE/custom-plugin/mermaid.js")
if [ "${mm%% *}" = "200" ] && [ "${mm##* }" -gt 100000 ]; then
  pass "mermaid script route served ${mm##* } bytes"
else
  fail "mermaid script route: $mm"
fi
fence_mm=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/custom-plugin/mermaid.js")
[ "$fence_mm" = "403" ] && pass "mermaid script route is behind the same fence" \
                        || fail "mermaid script route fence returned $fence_mm"

# Client→host diagnostics must reach the ring the status tool reads.
marker="livecheck-$$"
req POST /api/custom-plugin/diag "{\"msg\":\"$marker\"}" >/dev/null
printf '%s' "$(split "$(req GET /api/custom-plugin/debug)")" | grep -q "$marker" \
  && pass "diag report posted by the client reaches the host ring" \
  || fail "diag report never appeared in the host ring"

# Non-ASCII must survive the state round trip: a body-decoding regression lands
# as U+FFFD in the state file long before any UI would notice. Capture, append,
# assert, restore, verify — with node building both request bodies and curl
# reading them from a file, so nothing the operator stored ever passes through a
# shell argument (see req). Verifying the restore is the point: a probe that
# damaged the library has to report FAIL, not print a green over lost data.
probeDir=$(mktemp -d)
cat > "$probeDir/gen.cjs" <<'NODE'
const fs = require('fs')
const path = require('path')
const [statePath, out] = process.argv.slice(2)
let prompts = []
try { prompts = JSON.parse(fs.readFileSync(statePath, 'utf8')).prompts ?? [] } catch { prompts = [] }
const probe = { id: 'compat-utf8', name: '\u4e2d\u6587\u952e\u540d\u9a8c\u8bc1', text: 'probe' }
fs.writeFileSync(path.join(out, 'probe.json'), JSON.stringify({ prompts: [...prompts, probe] }))
fs.writeFileSync(path.join(out, 'restore.json'), JSON.stringify({ prompts }))
NODE
node "$probeDir/gen.cjs" "$STATE" "$probeDir"
want=$(printf '\xe4\xb8\xad\xe6\x96\x87\xe9\x94\xae\xe5\x90\x8d\xe9\xaa\x8c\xe8\xaf\x81')
wres=$(req POST /api/custom-plugin/state "@$probeDir/probe.json")
wrote=0
if [ "$(code "$wres")" = "200" ] && [ -f "$STATE" ] && grep -q "$want" "$STATE"; then
  wrote=1
  pass "state write keeps UTF-8 names byte-exact"
else
  fail "state write returned $(code "$wres"), or mangled non-ASCII to U+FFFD"
fi
rres=$(req POST /api/custom-plugin/state "@$probeDir/restore.json")
if [ "$(code "$rres")" != "200" ]; then
  fail "restore rejected ($(code "$rres")) — the library may still hold the probe entry"
elif node -e '
const fs = require("fs")
const stored = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).prompts ?? []
const wanted = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).prompts
process.exit(JSON.stringify(stored) === JSON.stringify(wanted) ? 0 : 1)
' "$STATE" "$probeDir/restore.json"; then
  pass "prompt library restored identical to before the probe"
else
  fail "prompt library was NOT restored identical (the probe damaged it)"
fi
rm -rf "$probeDir"

fence=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/custom-plugin/state")
[ "$fence" = "403" ] && pass "loopback + same-origin fence rejects an unmarked request" \
                     || fail "fence returned $fence instead of 403"

echo "== host-half probes done; client registration/rendering needs a browser pass"
if [ "$fails" -gt 0 ]; then echo "FAILED: $fails"; exit 1; fi
echo "OK: all live host checks passed"
