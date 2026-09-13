#!/bin/bash
# Phased memory harness: drives the real TUI through the features a real session
# touches (browse, reader, analytics, git, editor, composer) and prints the
# physical footprint after each phase, so a feature that costs 100MB to open is
# attributable instead of averaged into one peak.
#   REPO="$PWD" ./tui/opentui/memPhases.sh
set -u
: "${REPO:?set REPO to the repo root}"
# NODE_ENV is left as the caller set it, which is what the shipped TUI runs
# with — defaulting it here would measure a configuration nobody runs.
WORK=${MEM_CWD:-$(mktemp -d)}
MARKS=$(mktemp -d)/marks
cd "$WORK" || exit 1
# Phases: label:keys:reps:dwell
PHASES=${PHASES:-"browse-x8:j:8:0.5|reader-tab:$(printf '\t'):1:1.5|scroll:$(printf '\004'):8:0.4|analytics:$(printf '\001'):1:3|analytics-close:$(printf '\033'):1:1.5|git:$(printf '\007'):1:3|git-close:$(printf '\033'):1:1.5|editor:$(printf '\005'):1:4|editor-close:$(printf '\033\033'):1:2|composer:$(printf '\017'):1:2|composer-close:$(printf '\033'):1:1.5|browse-x12:j:12:0.4|settle::1:4"}
(
  sleep 8
  echo "boot $(date +%s)" >> "$MARKS"
  IFS='|' read -ra list <<< "$PHASES"
  for entry in "${list[@]}"; do
    label=${entry%%:*}; rest=${entry#*:}
    keys=${rest%%:*}; rest=${rest#*:}
    reps=${rest%%:*}; dwell=${rest#*:}
    for _ in $(seq 1 "$reps"); do
      i=0
      while [ $i -lt ${#keys} ]; do printf '%s' "${keys:$i:1}"; sleep 0.12; i=$((i+1)); done
      sleep "$dwell"
    done
    echo "$label $(date +%s)" >> "$MARKS"
  done
  sleep 2
) | script -q /dev/null bun run "$REPO/tui/opentui/main.tsx" >/dev/null 2>&1 &
DRIVER=$!
sleep 6
PID=$(/bin/ps -Ao pid=,command= | grep "tui/opentui/main.tsx" | grep -v grep | grep -v "script -q" | head -1 | awk '{print $1}')
[ -z "$PID" ] && { echo "TUI not found"; kill $DRIVER 2>/dev/null; exit 1; }
footprint() {
  /usr/bin/vmmap -summary "$PID" 2>/dev/null \
    | awk '/^Physical footprint:/{v=$3; if (v ~ /G$/) {sub(/G$/,"",v); print int(v*1024)}
           else if (v ~ /M$/) {sub(/M$/,"",v); print int(v)} else {sub(/K$/,"",v); print int(v/1024)}}'
}
seen=0
while kill -0 "$PID" 2>/dev/null; do
  if [ -f "$MARKS" ]; then
    n=$(wc -l < "$MARKS" | tr -d ' ')
    if [ "$n" -gt "$seen" ]; then
      seen=$n
      label=$(tail -1 "$MARKS" | awk '{print $1}')
      RSS=$(/bin/ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ')
      printf '%-18s fp=%sMB rss=%sMB\n' "$label" "$(footprint)" "$((RSS/1024))"
      [ "$label" = "settle" ] && break
    fi
  fi
  sleep 0.4
done
kill "$PID" $DRIVER 2>/dev/null; wait 2>/dev/null; exit 0
