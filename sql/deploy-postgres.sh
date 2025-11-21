#!/bin/bash

# PostgreSQL OneRoster Materialized Views Deployment Script
# Deploys PostgreSQL materialized views for OneRoster API
# Supports both Ed-Fi Data Standard 4 and 5

# Parse command line arguments for data standard
args=("$@")
dataStandard="ds5" # default

# Parse arguments: first arg might be data standard (ds4/ds5)
if [[ ${#args[@]} -gt 0 ]]; then
    if [[ "${args[0]}" == "ds4" || "${args[0]}" == "ds5" ]]; then
        dataStandard="${args[0]}"
    else
        echo "❌ Invalid data standard: ${args[0]}"
        echo "Usage: $0 [ds4|ds5]"
        echo "Examples:"
        echo "  $0 ds4    # Deploy to DS4 database"
        echo "  $0 ds5    # Deploy to DS5 database (default)"
        echo "  $0        # Deploy to DS5 database (default)"
        exit 1
    fi
fi

# Load appropriate environment files based on data standard
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(dirname "$script_dir")"

if [[ "$dataStandard" == "ds4" ]]; then
    echo "🔧 Using Ed-Fi Data Standard 4 configuration"
    source "$project_root/.env.ds4.postgres" 2>/dev/null || {
        echo "❌ Could not load .env.ds4.postgres file"
        echo "Please ensure .env.ds4.postgres exists in project root"
        exit 1
    }
else
    echo "🔧 Using Ed-Fi Data Standard 5 configuration (default)"
    source "$project_root/.env.postgres" 2>/dev/null || {
        echo "❌ Could not load .env.postgres file"
        echo "Please ensure .env.postgres exists in project root"
        exit 1
    }
fi

echo "========================================"
echo "OneRoster 1.2 PostgreSQL Deployment"
echo "========================================"
echo "📊 Data Standard: ${dataStandard^^}"
echo "Target Server: ${DB_HOST}:${DB_PORT}"
echo "Target Database: ${DB_NAME}"
echo "User: ${DB_USER}"
echo "Deployment Time: $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")"
echo "========================================"
echo ""

# PostgreSQL connection parameters from environment
export PGHOST="$DB_HOST"
export PGPORT="$DB_PORT"
export PGUSER="$DB_USER"
export PGPASSWORD="$DB_PASS"
export PGDATABASE="$DB_NAME"

# Configure SQL files and container based on data standard
if [[ "$dataStandard" == "ds4" ]]; then
    container_name="edfi-ds4-ods"
    users_sql_file="users_ds4.sql"
    enrollments_sql_file="enrollments_ds4.sql"
else
    container_name="ed-fi-db-ods"
    users_sql_file="users.sql"
    enrollments_sql_file="enrollments.sql"
fi

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
    "$users_sql_file"
    "$enrollments_sql_file"
)

# Files that create materialized views (for validation)
materialized_view_files=(
    "academic_sessions.sql:academicsessions"
    "orgs.sql:orgs"
    "courses.sql:courses"
    "classes.sql:classes"
    "demographics.sql:demographics"
    "$users_sql_file:users"
    "$enrollments_sql_file:enrollments"
)

# Function to check if a materialized view exists and has data
check_materialized_view() {
    local view_name=$1
    local sql_file=$2
    
    # Check if materialized view exists
    local exists=$(docker exec "$container_name" psql -U "$PGUSER" -d "$PGDATABASE" -t -c \
        "SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='oneroster12' AND matviewname='${view_name}');" 2>/dev/null | xargs)
    
    if [[ "$exists" != "t" ]]; then
        echo "❌ Materialized view oneroster12.${view_name} was not created by ${sql_file}"
        return 1
    fi
    
    # Check if materialized view has data (optional - could be empty legitimately)
    local row_count=$(docker exec "$container_name" psql -U "$PGUSER" -d "$PGDATABASE" -t -c \
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
if ! docker exec "$container_name" psql -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Failed to connect to PostgreSQL ($container_name)"
    echo "   Please ensure the container is running and accessible"
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
        if docker cp "$file_path" "$container_name":/tmp/${sql_file} 2>/dev/null; then
            exec_output=$(docker exec "$container_name" psql -U "$PGUSER" -d "$PGDATABASE" -f /tmp/${sql_file} 2>&1)
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
            docker exec "$container_name" rm -f /tmp/${sql_file} 2>/dev/null
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
echo ""
echo "🧪 Test deployment with:"
echo "node tests/compare-database.js $dataStandard  # Test data parity"
echo "========================================"

# Exit with error code if any files failed
exit $failed