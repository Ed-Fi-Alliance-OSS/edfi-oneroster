#!/bin/bash

# PostgreSQL OneRoster Materialized Views Deployment Script
# Deploys PostgreSQL materialized views for OneRoster API

echo "========================================"
echo "OneRoster 1.2 PostgreSQL Deployment"
echo "========================================"
echo "Target Server: localhost:5434"
echo "Target Database: EdFi_Ods_Sandbox_populatedKey"
echo "User: postgres"
echo "Deployment Time: $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")"
echo "========================================"
echo ""

# PostgreSQL connection parameters
export PGHOST=localhost
export PGPORT=5434
export PGUSER=postgres
export PGPASSWORD="EdFi-Postgres-2024!"
export PGDATABASE=EdFi_Ods_Sandbox_populatedKey

# SQL files to execute in order
sql_files=(
    "00_setup.sql"
    "01_descriptors.sql" 
    "02_descriptorMappings.sql"
    "academic_sessions.sql"
    "orgs.sql"
    "courses.sql"
    "classes.sql"
    "demographics.sql"
    "users.sql"
    "enrollments.sql"
)

# Files that create materialized views (for validation)
materialized_view_files=(
    "academic_sessions.sql:academicsessions"
    "orgs.sql:orgs"
    "courses.sql:courses"
    "classes.sql:classes"
    "demographics.sql:demographics"
    "users.sql:users"
    "enrollments.sql:enrollments"
)

# Function to check if a materialized view exists and has data
check_materialized_view() {
    local view_name=$1
    local sql_file=$2
    
    # Check if materialized view exists
    local exists=$(docker exec ed-fi-db-ods psql -U postgres -d EdFi_Ods_Sandbox_populatedKey -t -c \
        "SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='oneroster12' AND matviewname='${view_name}');" 2>/dev/null | xargs)
    
    if [[ "$exists" != "t" ]]; then
        echo "❌ Materialized view oneroster12.${view_name} was not created by ${sql_file}"
        return 1
    fi
    
    # Check if materialized view has data (optional - could be empty legitimately)
    local row_count=$(docker exec ed-fi-db-ods psql -U postgres -d EdFi_Ods_Sandbox_populatedKey -t -c \
        "SELECT COUNT(*) FROM oneroster12.${view_name};" 2>/dev/null | xargs)
    
    if [[ "$row_count" =~ ^[0-9]+$ ]]; then
        echo "✅ Materialized view oneroster12.${view_name} created successfully (${row_count} rows)"
        return 0
    else
        echo "⚠️  Materialized view oneroster12.${view_name} created but row count check failed"
        return 1
    fi
}

echo "🔌 Connecting to PostgreSQL..."

# Test connection using docker exec
if ! docker exec ed-fi-db-ods psql -U postgres -d EdFi_Ods_Sandbox_populatedKey -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Failed to connect to PostgreSQL"
    exit 1
fi

echo "✅ Connected successfully"
echo ""

# Get current directory (should be /sql)
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

successful=0
failed=0
mv_validation_failed=0

# Execute each SQL file
for sql_file in "${sql_files[@]}"; do
    file_path="${script_dir}/${sql_file}"
    
    if [[ -f "$file_path" ]]; then
        echo "⚡ Executing ${sql_file}..."
        
        # Copy file to container and execute it, capture output for error reporting
        exec_output=""
        if docker cp "$file_path" ed-fi-db-ods:/tmp/${sql_file} 2>/dev/null; then
            exec_output=$(docker exec ed-fi-db-ods psql -U postgres -d EdFi_Ods_Sandbox_populatedKey -f /tmp/${sql_file} 2>&1)
            exit_code=$?
            
            if [[ $exit_code -eq 0 ]]; then
                echo "✅ ${sql_file} executed successfully"
                ((successful++))
                
                # Check if this file should create a materialized view
                for mv_entry in "${materialized_view_files[@]}"; do
                    if [[ "$mv_entry" == "${sql_file}:"* ]]; then
                        view_name="${mv_entry#*:}"
                        if ! check_materialized_view "$view_name" "$sql_file"; then
                            ((mv_validation_failed++))
                            ((failed++))
                        fi
                        break
                    fi
                done
                
            else
                echo "❌ Error executing ${sql_file}"
                echo "SQL Error Output:"
                echo "$exec_output" | sed 's/^/  /'
                ((failed++))
            fi
            
            # Clean up temp file
            docker exec ed-fi-db-ods rm -f /tmp/${sql_file} 2>/dev/null
        else
            echo "❌ Failed to copy ${sql_file} to container"
            ((failed++))
        fi
    else
        echo "⚠️  Skipping ${sql_file} (file not found)"
        ((failed++))
    fi
done

echo ""
echo "========================================"

if [[ $failed -eq 0 ]]; then
    echo "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
    echo "✅ All materialized views created and validated"
else
    echo "❌ DEPLOYMENT COMPLETED WITH ERRORS!"
    if [[ $mv_validation_failed -gt 0 ]]; then
        echo "⚠️  ${mv_validation_failed} materialized view validation(s) failed"
    fi
fi

echo "📊 SQL Files: ${successful} successful, ${failed} failed"
if [[ $mv_validation_failed -gt 0 ]]; then
    echo "🔍 Materialized View Validations: ${mv_validation_failed} failed"
fi
echo "========================================"

# Exit with error code if any files failed
exit $failed