#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting Jarvis CEO Cockpit..."

cd "$ROOT" && node src/index.js &
API_PID=$!

cd "$ROOT/dashboard" && npm run dev &
DASH_PID=$!

echo "API running on http://localhost:3000"
echo "Dashboard running on http://localhost:5173"
echo "Press Ctrl+C to stop"

trap "kill $API_PID $DASH_PID 2>/dev/null" EXIT INT TERM
wait
