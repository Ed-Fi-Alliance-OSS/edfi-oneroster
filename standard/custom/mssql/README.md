# MSSQL Custom Post-Refresh SQL

Place implementer-owned `.sql` files in this directory.

The deployment script (`node standard/deploy-mssql.js ds5` or `ds4`) executes files in this folder after all Ed-Fi MSSQL artifacts, including the post-refresh extension framework.

## Use Case

Use this folder to register enrichment procedures that run after a successful `oneroster12.sp_refresh_all`, without editing Ed-Fi-shipped SQL artifacts.

## Procedure Contract

Each registered procedure should accept these parameters:

```sql
@MasterRefreshHistoryId INT,
@RunContext NVARCHAR(50)
```

## Example: Add Custom Metadata and userIds

```sql
CREATE OR ALTER PROCEDURE oneroster12.sp_enrich_users_custom_fields
    @MasterRefreshHistoryId INT,
    @RunContext NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Example metadata enrichment
    UPDATE u
    SET metadata = JSON_MODIFY(
        COALESCE(NULLIF(u.metadata, ''), '{}'),
        '$.customExtension',
        JSON_QUERY('{"source":"district-system","runContext":"' + @RunContext + '"}')
    )
    FROM oneroster12.users u;

    -- Example userIds enrichment (adds only when customId is missing)
    UPDATE u
    SET userIds =
        CASE
            WHEN u.userIds IS NULL OR LTRIM(RTRIM(u.userIds)) = '' THEN
                '[{"type":"districtUserId","identifier":"' + u.sourcedId + '"}]'
            ELSE u.userIds
        END
    FROM oneroster12.users u;
END
GO

EXEC oneroster12.sp_register_post_refresh_extension
    @ExtensionName = 'Custom Users Enrichment',
    @ProcedureSchema = 'oneroster12',
    @ProcedureName = 'sp_enrich_users_custom_fields',
    @ExecutionOrder = 100,
    @Enabled = 1,
    @ContinueOnError = 1,
    @Description = 'Adds implementer-owned metadata and userIds after refresh success.';
GO
```

## Monitor Extension Runs

```sql
SELECT TOP 50 *
FROM oneroster12.post_refresh_extension_log
ORDER BY started_at DESC;
```
