#!/usr/bin/env bash
# Driftline multiplayer server — one-command start (macOS / Linux)
# Installs dependencies on first run, then starts the server + public tunnel.
set -e
cd "$(dirname "$0")"

echo "🛞  Starting the Driftline multiplayer server…"

# install dependencies on first run (prefer bun, fall back to npm)
if [ ! -d node_modules/ws ]; then
  if command -v bun >/dev/null 2>&1; then
    echo "   installing dependencies (bun)…"
    bun install
  elif command -v npm >/dev/null 2>&1; then
    echo "   installing dependencies (npm)…"
    npm install --no-audit --no-fund --loglevel=error
  else
    echo "❌  Node.js is required. Install it from https://nodejs.org and run this again."
    exit 1
  fi
fi

# run (bun if available, otherwise node)
if command -v bun >/dev/null 2>&1; then
  exec bun server.js
else
  exec node server.js
fi
