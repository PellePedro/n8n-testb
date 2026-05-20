#!/bin/bash
set -euo pipefail

# TestBot setup for n8n 2.x.
# Brings up the container, creates the owner account on first boot, mints a
# long-lived API key with every available scope, and persists the raw key to
# `.api-key` next to this script for `get-token.sh` to read.
#
# Idempotent: safe to re-run. Reuses an existing key if it still works against
# the running instance; otherwise regenerates against the owner account.

cd "$(dirname "$0")"

BASE_URL="${N8N_BASE_URL:-http://localhost:5678}"
OWNER_EMAIL="${N8N_OWNER_EMAIL:-testbot@example.com}"
OWNER_PASSWORD="${N8N_OWNER_PASSWORD:-TestBotPass123!}"
OWNER_FIRST_NAME="${N8N_OWNER_FIRST_NAME:-Test}"
OWNER_LAST_NAME="${N8N_OWNER_LAST_NAME:-Bot}"
KEY_FILE=".api-key"

echo "Current directory: $(pwd)"
echo "Starting n8n service..."
docker compose up -d

echo "Waiting for n8n to become healthy..."
# /healthz comes up before the REST routes are mounted, so poll a REST endpoint:
# POST /rest/login with an empty body returns 400 (validation error) once routes
# are live; before that it 404s.
for i in {1..120}; do
  rest_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -H 'content-type: application/json' --data '{}' \
    "$BASE_URL/rest/login" || true)
  if [ "$rest_status" = "400" ] || [ "$rest_status" = "401" ] || [ "$rest_status" = "200" ]; then
    echo "  ready after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 120 ]; then
    echo "ERROR: n8n REST API not ready within 120s (last status: $rest_status)" >&2
    docker compose logs --tail 30 >&2
    exit 1
  fi
done

# If a saved key still authenticates against the API, reuse it.
if [ -f "$KEY_FILE" ]; then
  existing_key=$(cat "$KEY_FILE")
  if curl -sf -H "X-N8N-API-KEY: $existing_key" "$BASE_URL/api/v1/workflows" > /dev/null; then
    echo "Existing API key in $KEY_FILE is valid; reusing."
    echo "n8n setup complete"
    exit 0
  fi
  echo "Saved API key is stale; regenerating."
fi

# Owner setup is one-shot. Try login first to detect whether the owner exists.
login_payload=$(printf '{"emailOrLdapLoginId":"%s","password":"%s"}' "$OWNER_EMAIL" "$OWNER_PASSWORD")
login_status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H 'content-type: application/json' \
  --data "$login_payload" \
  "$BASE_URL/rest/login")

if [ "$login_status" != "200" ]; then
  echo "Creating owner account ($OWNER_EMAIL)..."
  setup_payload=$(printf '{"email":"%s","password":"%s","firstName":"%s","lastName":"%s"}' \
    "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_FIRST_NAME" "$OWNER_LAST_NAME")
  setup_status=$(curl -s -o /tmp/n8n-owner-setup.json -w "%{http_code}" \
    -X POST -H 'content-type: application/json' \
    --data "$setup_payload" \
    "$BASE_URL/rest/owner/setup")
  if [ "$setup_status" != "200" ]; then
    echo "ERROR: owner setup failed (HTTP $setup_status)" >&2
    cat /tmp/n8n-owner-setup.json >&2
    exit 1
  fi
fi

echo "Logging in to obtain session cookie..."
auth_cookie=$(curl -sS -D - -o /dev/null \
  -X POST -H 'content-type: application/json' \
  --data "$login_payload" \
  "$BASE_URL/rest/login" \
  | grep -i '^set-cookie:' \
  | sed -E 's/.*n8n-auth=([^;]+).*/\1/' \
  | tr -d '\r\n')

if [ -z "$auth_cookie" ]; then
  echo "ERROR: failed to capture n8n-auth cookie from login" >&2
  exit 1
fi

echo "Fetching available API key scopes..."
scopes_json=$(curl -sf -b "n8n-auth=$auth_cookie" "$BASE_URL/rest/api-keys/scopes")
scopes_array=$(printf '%s' "$scopes_json" | python3 -c 'import sys, json; print(json.dumps(json.load(sys.stdin)["data"]))')

# Drop any pre-existing key with the same label so creation never collides
# (n8n enforces label uniqueness per user).
existing_keys=$(curl -sf -b "n8n-auth=$auth_cookie" "$BASE_URL/rest/api-keys")
stale_ids=$(printf '%s' "$existing_keys" | python3 -c \
  'import sys, json; print(" ".join(k["id"] for k in json.load(sys.stdin)["data"] if k["label"] == "testbot"))')
for id in $stale_ids; do
  echo "Removing stale 'testbot' API key ($id)..."
  curl -sf -X DELETE -b "n8n-auth=$auth_cookie" "$BASE_URL/rest/api-keys/$id" > /dev/null
done

echo "Creating API key..."
key_payload=$(python3 -c "import json,sys; print(json.dumps({'label':'testbot','scopes':$scopes_array,'expiresAt':None}))")
key_response=$(curl -sf -X POST -H 'content-type: application/json' \
  -b "n8n-auth=$auth_cookie" \
  --data "$key_payload" \
  "$BASE_URL/rest/api-keys")

raw_api_key=$(printf '%s' "$key_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["rawApiKey"])')

# Restrict the key file: it grants full API access.
umask 077
printf '%s' "$raw_api_key" > "$KEY_FILE"

echo "API key written to $(pwd)/$KEY_FILE"
echo "n8n setup complete"
