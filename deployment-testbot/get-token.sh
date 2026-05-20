#!/bin/bash
# TestBot auth-token command for n8n.
# Prints the raw n8n API key written by setup.sh. Use as `X-N8N-API-KEY` header
# against /api/v1/* endpoints.

set -euo pipefail

cd "$(dirname "$0")"

KEY_FILE=".api-key"

if [ ! -s "$KEY_FILE" ]; then
  echo "ERROR: $KEY_FILE not found. Run setup.sh first." >&2
  exit 1
fi

cat "$KEY_FILE"
