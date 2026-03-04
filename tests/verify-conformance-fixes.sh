#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Verify OneRoster v1.2 conformance fixes from PR #57
# Tests: #56 (educationOrganizationId leak), #58 (imsx error format), #59 (academicSessions casing)
#
# Usage:
#   ./tests/verify-conformance-fixes.sh \
#     --base-url https://localhost:3000 \
#     --token-url https://localhost/oauth/token \
#     --client-id myKey \
#     --client-secret mySecret

set -uo pipefail

# --- Parse args ---
BASE_URL=""
TOKEN_URL=""
CLIENT_ID=""
CLIENT_SECRET=""

OR_SCOPES="https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly"

while [[ $# -gt 0 ]]; do
  case $1 in
    --base-url)     BASE_URL="$2"; shift 2 ;;
    --token-url)    TOKEN_URL="$2"; shift 2 ;;
    --client-id)    CLIENT_ID="$2"; shift 2 ;;
    --client-secret) CLIENT_SECRET="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$BASE_URL" || -z "$TOKEN_URL" || -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Usage: $0 --base-url URL --token-url URL --client-id ID --client-secret SECRET"
  exit 1
fi

# --- Get token (with OneRoster scopes) ---
echo "Fetching token from $TOKEN_URL ..."
TOKEN_RESPONSE=$(curl -sk -X POST "$TOKEN_URL" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials&scope=${OR_SCOPES}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
if [[ -z "$TOKEN" ]]; then
  echo "FAIL: Could not obtain token"
  echo "$TOKEN_RESPONSE"
  exit 1
fi
echo "OK: Token obtained"
echo ""

AUTH="Authorization: Bearer $TOKEN"
PASS=0
FAIL=0
ROSTER="$BASE_URL/ims/oneroster/rostering/v1p2"

pass() { echo "  PASS: $1"; ((PASS++)); }
fail() { echo "  FAIL: $1"; ((FAIL++)); }

# --- Helper: check response has no educationOrganizationId ---
check_no_edorgid() {
  local label="$1" body="$2"
  # Check top-level properties of the resource object (not nested metadata)
  if echo "$body" | jq -e 'to_entries[].value | if type == "object" then has("educationOrganizationId") else false end' 2>/dev/null | grep -q true; then
    fail "$label — response contains educationOrganizationId"
  else
    pass "$label — no educationOrganizationId in response"
  fi
}

# --- Helper: check imsx format ---
check_imsx_format() {
  local label="$1" body="$2"
  if echo "$body" | jq -e '.imsx_codeMajor and .imsx_severity and .imsx_description' &>/dev/null; then
    pass "$label — has imsx_StatusInfo format"
  else
    fail "$label — missing imsx_StatusInfo fields"
  fi
  if echo "$body" | jq -e 'has("error")' &>/dev/null; then
    fail "$label — contains non-spec 'error' property"
  else
    pass "$label — no non-spec 'error' property"
  fi
  if echo "$body" | jq -e 'has("imsx_CodeMinor")' &>/dev/null; then
    fail "$label — contains non-spec 'imsx_CodeMinor' property"
  else
    pass "$label — no non-spec 'imsx_CodeMinor' property"
  fi
}

# ============================================================
echo "=== #56: queryOne must not return educationOrganizationId ==="
echo ""

ENDPOINTS=(orgs classes courses users enrollments demographics academicSessions)
for ep in "${ENDPOINTS[@]}"; do
  # Get a sourcedId from the collection
  BODY=$(curl -sk "$ROSTER/$ep?limit=1" -H "$AUTH")
  # Extract first sourcedId from any array value in the response
  SID=$(echo "$BODY" | jq -r '[.. | objects | .sourcedId? // empty] | first // empty')
  if [[ -z "$SID" ]]; then
    fail "$ep — could not get a sourcedId from collection (auth/scope issue?)"
    continue
  fi
  # Fetch single record
  ONE=$(curl -sk "$ROSTER/$ep/$SID" -H "$AUTH")
  check_no_edorgid "GET $ep/$SID" "$ONE"
done
echo ""

# ============================================================
echo "=== #58: Error responses must use imsx_StatusInfo format ==="
echo ""

# 404 — non-existent sourcedId
echo "-- 404 responses --"
BODY_404=$(curl -sk "$ROSTER/orgs/does-not-exist-00000000" -H "$AUTH")
check_imsx_format "GET orgs/{bad-id} 404" "$BODY_404"

# 400 — invalid filter field
echo "-- 400 responses --"
BODY_400=$(curl -sk "$ROSTER/orgs?filter=badField%3D%27x%27" -H "$AUTH")
check_imsx_format "GET orgs?filter=badField 400" "$BODY_400"
echo ""

# ============================================================
echo "=== #59: academicSessions JSON wrapper names ==="
echo ""

# Collection wrapper
BODY_COLL=$(curl -sk "$ROSTER/academicSessions?limit=1" -H "$AUTH")
if echo "$BODY_COLL" | jq -e '.academicSessions' &>/dev/null; then
  pass "Collection wrapper is 'academicSessions' (camelCase)"
else
  fail "Collection wrapper is not 'academicSessions'"
  echo "  Keys found: $(echo "$BODY_COLL" | jq -r 'keys[]')"
fi

# Single record wrapper
SID=$(echo "$BODY_COLL" | jq -r '.academicSessions[0].sourcedId // empty')
if [[ -n "$SID" ]]; then
  BODY_ONE=$(curl -sk "$ROSTER/academicSessions/$SID" -H "$AUTH")
  if echo "$BODY_ONE" | jq -e '.academicSession' &>/dev/null; then
    pass "Single wrapper is 'academicSession' (camelCase)"
  else
    fail "Single wrapper is not 'academicSession'"
    echo "  Keys found: $(echo "$BODY_ONE" | jq -r 'keys[]')"
  fi
  check_no_edorgid "GET academicSessions/$SID" "$BODY_ONE"
else
  fail "Could not get academicSession sourcedId for single-record test"
fi

# gradingPeriods / terms wrappers
for ep in gradingPeriods terms; do
  BODY_SUB=$(curl -sk "$ROSTER/$ep?limit=1" -H "$AUTH")
  if echo "$BODY_SUB" | jq -e '.academicSessions' &>/dev/null; then
    pass "$ep collection wrapper is 'academicSessions'"
  else
    fail "$ep collection wrapper is not 'academicSessions'"
  fi
done
echo ""

# ============================================================
echo "=============================="
echo "Results: $PASS passed, $FAIL failed"
echo "=============================="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
