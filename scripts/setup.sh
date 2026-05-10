#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Setting up Jarvis..."

# Backend deps
cd "$ROOT"
npm install

# Dashboard deps
cd "$ROOT/dashboard"
npm install

# Create .env from example if not present
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo ".env created — fill in your tokens before starting"
fi

chmod +x "$ROOT/scripts/start.sh"
echo "Setup complete. Run: bash scripts/start.sh"
