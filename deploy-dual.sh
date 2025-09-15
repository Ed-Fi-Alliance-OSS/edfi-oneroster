#!/bin/bash

# OneRoster API Dual Database Deployment Script
# Deploys both PostgreSQL (port 3000) and MSSQL (port 3001) instances

set -e

echo "=========================================="
echo "OneRoster API Dual Database Deployment"
echo "=========================================="
echo "PostgreSQL API: http://localhost:3000 (external: http://35.215.110.73:3000)"
echo "MSSQL API:      http://localhost:3001 (external: http://35.215.110.73:3001)"
echo "=========================================="

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker compose -f docker-compose.dual.yml down 2>/dev/null || echo "No existing containers to stop"

# Build the image
echo "🔨 Building Docker image..."
docker compose -f docker-compose.dual.yml build

# Start both services
echo "🚀 Starting both API instances..."
docker compose -f docker-compose.dual.yml up api-postgres api-mssql -d

# Wait a moment for containers to start
echo "⏳ Waiting for containers to start..."
sleep 5

# Check health of both instances
echo "🏥 Checking health status..."
echo ""

echo "PostgreSQL API (port 3000):"
if curl -s http://localhost:3000/health-check > /dev/null 2>&1; then
    curl -s http://localhost:3000/health-check | jq '{ status: .status, database: .database, abstraction: .abstraction }'
else
    echo "❌ PostgreSQL API not responding"
fi

echo ""
echo "MSSQL API (port 3001):"
if curl -s http://localhost:3001/health-check > /dev/null 2>&1; then
    curl -s http://localhost:3001/health-check | jq '{ status: .status, database: .database, abstraction: .abstraction }'
else
    echo "❌ MSSQL API not responding"
fi

echo ""
echo "=========================================="
echo "✅ Deployment complete!"
echo ""
echo "Test commands (local):"
echo "curl http://localhost:3000/ims/oneroster/rostering/v1p2/orgs  # PostgreSQL"
echo "curl http://localhost:3001/ims/oneroster/rostering/v1p2/orgs  # MSSQL"
echo ""
echo "Test commands (external):"
echo "curl http://35.215.110.73:3000/ims/oneroster/rostering/v1p2/orgs  # PostgreSQL"
echo "curl http://35.215.110.73:3001/ims/oneroster/rostering/v1p2/orgs  # MSSQL"
echo ""
echo "Integration tests (local):"
echo "node tests/integration/test-oneroster-api.js                    # PostgreSQL (port 3000)"
echo "BASE_URL=http://localhost:3001 node tests/integration/test-oneroster-api.js  # MSSQL (port 3001)"
echo ""
echo "Integration tests (external):"
echo "BASE_URL=http://35.215.110.73:3000 node tests/integration/test-oneroster-api.js  # PostgreSQL"
echo "BASE_URL=http://35.215.110.73:3001 node tests/integration/test-oneroster-api.js  # MSSQL"
echo "=========================================="