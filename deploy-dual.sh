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

# Manage the DS4 PostgreSQL container
echo "🔄 Managing DS4 PostgreSQL container..."
if docker ps -a --format '{{.Names}}' | grep -q "^edfi-ds4-ods$"; then
    echo "   Stopping existing edfi-ds4-ods container..."
    docker stop edfi-ds4-ods 2>/dev/null || true
    docker rm edfi-ds4-ods 2>/dev/null || true
fi

# Start the DS4 container with the new image
echo "   Starting DS4 PostgreSQL container (Ed-Fi Data Standard 4.0)..."
docker run -d \
    --name edfi-ds4-ods \
    -p 5435:5432 \
    -e TPDM_ENABLED=false \
    -e POSTGRES_PASSWORD=P@ssw0rd \
    edfialliance/ods-api-db-ods-sandbox:7.3-4.0.0 2>/dev/null || echo "   ⚠️  Could not start edfi-ds4-ods container"

# Wait for PostgreSQL to be ready and enable connections on DS4 database
if docker ps --format '{{.Names}}' | grep -q "^edfi-ds4-ods$"; then
    echo "   Waiting for DS4 PostgreSQL to be ready..."
    
    # Wait up to 30 seconds for PostgreSQL to be ready
    for i in {1..30}; do
        if docker exec edfi-ds4-ods psql -U postgres -c "SELECT 1;" >/dev/null 2>&1; then
            echo "   PostgreSQL is ready (took ${i} seconds)"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "   ⚠️  PostgreSQL not ready after 30 seconds"
        fi
        sleep 1
    done
    
    echo "   Configuring DS4 database connections..."
    # Use UPDATE on pg_database to ensure connections are enabled
    if docker exec edfi-ds4-ods psql -U postgres -c "UPDATE pg_database SET datallowconn = 't' WHERE datname = 'EdFi_Ods_Populated_Template';"; then
        echo "   ✅ DS4 database configured for connections"
    else
        echo "   ⚠️  Could not configure DS4 database (may already be configured)"
    fi
    
    
    echo "   ✅ DS4 container started successfully"
else
    echo "   ⚠️  edfi-ds4-ods container failed to start (DS4 testing unavailable)"
fi

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

# Check DS4 container status
echo "📊 DS4 Container Status:"
if docker ps --format '{{.Names}}' | grep -q "^edfi-ds4-ods$"; then
    echo "   ✅ edfi-ds4-ods: Running (for DS4 testing)"
else
    echo "   ⚠️  edfi-ds4-ods: Not running (DS4 testing unavailable)"
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
echo ""
echo "Database comparison tests:"
echo "node tests/compare-database.js ds5        # Compare DS5 PostgreSQL vs MSSQL"
echo "node tests/compare-database.js ds4        # Compare DS4 PostgreSQL vs MSSQL"
echo "node tests/compare-database.js ds5 users  # Compare specific DS5 endpoint"
echo "=========================================="