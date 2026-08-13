#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing. Copy .env.example to .env and set the required values." >&2
  exit 1
fi

for command in node npm python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $command" >&2
    exit 1
  fi
done

if [[ ! -d node_modules ]]; then
  echo "ERROR: node_modules is missing. Run npm install first." >&2
  exit 1
fi

if [[ -z "${VITE_VAPI_PUBLIC_KEY:-}" ]]; then
  VITE_VAPI_PUBLIC_KEY="$(sed -n 's/^VITE_VAPI_PUBLIC_KEY=//p' .env | tail -1)"
fi
if [[ -z "${VITE_VAPI_ASSISTANT_ID:-}" ]]; then
  VITE_VAPI_ASSISTANT_ID="$(sed -n 's/^VITE_VAPI_ASSISTANT_ID=//p' .env | tail -1)"
fi

if [[ -z "$VITE_VAPI_PUBLIC_KEY" ]]; then
  echo "ERROR: VITE_VAPI_PUBLIC_KEY is not configured." >&2
  exit 1
fi
if [[ -z "$VITE_VAPI_ASSISTANT_ID" ]]; then
  echo "ERROR: VITE_VAPI_ASSISTANT_ID is not configured. Run the Vapi provisioning step first." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]] && ! grep -q '^DATABASE_URL=' .env; then
  echo "WARNING: DATABASE_URL is not configured; local fixture persistence will be used." >&2
fi
if [[ -z "${OAUTH_SERVER_URL:-}" ]] && ! grep -q '^OAUTH_SERVER_URL=' .env; then
  echo "WARNING: OAUTH_SERVER_URL is not configured; external OAuth is disabled." >&2
fi

echo "Starting Observe Insurance Voice Agent..."
echo "Application: http://localhost:3005"
echo "Admin console: http://localhost:3005/admin"
echo "Backend health: http://127.0.0.1:8099/api/health"
exec npm run dev -- --host 127.0.0.1
