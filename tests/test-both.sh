#!/bin/bash

# OneRoster API Database Comparison Test Script
# Tests both PostgreSQL and MSSQL instances and compares results

set -e

echo "=============================================="
echo "OneRoster API Database Comparison Test"
echo "=============================================="

# Test PostgreSQL (port 3000)
echo ""
echo "🐘 Testing PostgreSQL API (port 3000)..."
echo "=============================================="
echo ""
node tests/integration/test-oneroster-api.js

echo ""
echo ""
echo "=============================================="

# Test MSSQL (port 3001)
echo ""
echo "🗄️  Testing MSSQL API (port 3001)..."
echo "=============================================="
echo ""
env BASE_URL=http://localhost:3001 node tests/integration/test-oneroster-api.js

echo ""
echo ""
echo "=============================================="
echo "✅ Comparison Test Complete!"
echo ""
echo "Quick API checks:"
echo "PostgreSQL orgs count: $(curl -s http://localhost:3000/ims/oneroster/rostering/v1p2/orgs | jq '.orgs | length')"
echo "MSSQL orgs count:      $(curl -s http://localhost:3001/ims/oneroster/rostering/v1p2/orgs | jq '.orgs | length')"
echo "=============================================="