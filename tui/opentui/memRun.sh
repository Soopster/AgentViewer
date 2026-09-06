#!/bin/bash
set -u
STEPS=${1:-16}
export NODE_ENV=${2:-development}
: "${REPO:?set REPO to the repo root}"
cd "$(mktemp -d)" || exit 1
export AGENT_VIEWER_TUI_MEM=${AGENT_VIEWER_TUI_MEM:-0}
export AGENT_VIEWER_TUI_MEM_LOG="$PWD/tui-mem.log"
# KEYS overrides the drive sequence (one char per step, cycled). The default
# 'j' walks the sidebar; 'j\t' also Tabs into the reader, which is what makes
# the app fetch session metadata — plain sidebar navigation never does.
KEYS=${KEYS:-j}
( sleep 6
  for i in $(seq 1 "$STEPS"); do
    idx=$(( (i - 1) % ${#KEYS} ))
    printf '%s' "${KEYS:$idx:1}"
    sleep 0.8
  done
  sleep 4 ) \
  | script -q /dev/null bun run "$REPO/tui/opentui/main.tsx" >/dev/null 2>&1 &
DRIVER=$!
sleep 5
find_pid() { /bin/ps -Ao pid=,rss=,command= | grep "tui/opentui/main.tsx" | grep -v grep | grep -v "script -q" | sort -k2 -n -r | head -1 | awk '{print $1}'; }
PID=$(find_pid)
if [ -z "$PID" ]; then echo "TUI process not found"; kill $DRIVER 2>/dev/null; exit 1; fi
# Sample footprint throughout, not once at the end: a single reading lands
# wherever the collector happened to leave the heap and swings by 2x between
# identical runs. Peak is the number a user feels as "how much is this thing
# using"; final is what it settles back to.
footprint_kb() {
  /usr/bin/vmmap -summary "$PID" 2>/dev/null \
    | awk '/^Physical footprint:/{v=$3; if (v ~ /G$/) {sub(/G$/,"",v); print v*1024*1024}
           else if (v ~ /M$/) {sub(/M$/,"",v); print v*1024} else {sub(/K$/,"",v); print v}}'
}
DEADLINE=$(( $(date +%s) + 8 + STEPS )); PEAK=0; LAST=0; FPEAK=0; FLAST=0
while [ "$(date +%s)" -lt "$DEADLINE" ] && kill -0 "$PID" 2>/dev/null; do
  RSS=$(/bin/ps -o rss= -p "$PID" 2>/dev/null | tr -d ' '); [ -z "$RSS" ] && break
  [ "$RSS" -gt "$PEAK" ] && PEAK=$RSS; LAST=$RSS
  FP=$(footprint_kb)
  if [ -n "$FP" ]; then FP=${FP%%.*}; [ "$FP" -gt "$FPEAK" ] && FPEAK=$FP; FLAST=$FP; fi
  sleep 0.5
done
# Physical footprint, not RSS: RSS counts the resident slice of Bun's own ~2GB
# binary, which is shared and file-backed, so it swamps the app's real cost and
# swings by 100MB+ between identical runs. Footprint is what macOS charges the
# process and is what actually moves when the app allocates less.
echo "NODE_ENV=$NODE_ENV steps=$STEPS  footprintPeak=$((FPEAK/1024))MB  footprintFinal=$((FLAST/1024))MB  rssPeak=$((PEAK/1024))MB"
[ "$AGENT_VIEWER_TUI_MEM" = "1" ] && [ -s "$AGENT_VIEWER_TUI_MEM_LOG" ] && cat "$AGENT_VIEWER_TUI_MEM_LOG"
kill "$PID" 2>/dev/null; kill $DRIVER 2>/dev/null; wait 2>/dev/null; exit 0
