#!/usr/bin/env bash
# Nimion HQ setup: checks what it needs and, with --service on macOS, starts it at every login.
# Usage: ./setup.sh [project-folder] [--service]
set -uo pipefail
cd "$(dirname "$0")"
HQ="$PWD" PROJECT="" SERVICE=0 fail=0
for a in "$@"; do if [ "$a" = --service ]; then SERVICE=1; else PROJECT="$(cd "$a" && pwd)" || exit 1; fi; done
ok() { printf '  ✅ %s\n' "$1"; }
bad() { printf '  ❌ %s\n' "$1"; fail=1; }

echo "Nimion HQ setup"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then ok "Node $(node -v)"
else bad "Node 18 or later is needed: https://nodejs.org"; fi
if command -v claude >/dev/null; then ok "Claude Code $(claude --version | cut -d' ' -f1)"
else bad "Claude Code is needed: npm install -g @anthropic-ai/claude-code  (or https://docs.claude.com/en/docs/claude-code/setup)"; fi
[ $fail = 0 ] || exit 1

# The same check the server makes before any run: signed in with a Claude plan, and no API key that would take over.
status="$(env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude auth status 2>/dev/null)"
problem="$(node --input-type=module -e "import { authProblem } from './server.mjs'; let s = null; try { s = JSON.parse(process.argv[1]); } catch {} console.log(authProblem(s) ?? '')" "$status")"
if [ -n "$problem" ]; then bad "$problem"; echo "     Sign in with:  claude auth login   (pick your Claude.ai account), then run this again."; exit 1; fi
ok "Signed in with your Claude plan ($(node -p 'JSON.parse(process.argv[1]).subscriptionType || "Claude"' "$status"))"
[ -f crew.json ] || { cp crew.example.json crew.json; ok "Created crew.json from the sample crew"; }
node test.mjs >/dev/null && ok "Self-tests pass" || bad "Self-tests failed: run  node test.mjs"

if [ $SERVICE = 1 ]; then
  [ "$(uname)" = Darwin ] || { echo "--service is for macOS. Elsewhere, run: npm start -- ${PROJECT:-<project-folder>}"; exit 1; }
  plist="$HOME/Library/LaunchAgents/local.nimion-hq.plist"
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  # Settings given to this command (PORT and any HQ_ variable) are saved with the service, so it starts with them at every login.
  extra=""
  for v in PORT $(env | sed -n 's/^\(HQ_[A-Z_]*\)=.*/\1/p'); do
    val="$(printf '%s' "${!v:-}" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
    [ -n "$val" ] && extra="$extra<key>$v</key><string>$val</string>"
  done
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.nimion-hq</string>
  <key>ProgramArguments</key>
  <array><string>$(command -v node)</string><string>$HQ/server.mjs</string>${PROJECT:+<string>$PROJECT</string>}</array>
  <key>WorkingDirectory</key><string>$HQ</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string>$extra</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/nimion-hq.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/nimion-hq.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/local.nimion-hq" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$plist" && ok "Runs at login (logs: ~/Library/Logs/nimion-hq.log)"
  sleep 2; open "http://localhost:${PORT:-4321}" 2>/dev/null
else
  echo; echo "Start it:   npm start${PROJECT:+ -- \"$PROJECT\"}"; echo "Then open:  http://localhost:4321"
fi
