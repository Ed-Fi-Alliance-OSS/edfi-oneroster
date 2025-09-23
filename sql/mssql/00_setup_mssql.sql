-- =============================================
-- MS SQL Server Setup Script for OneRoster 1.2
-- Creates the oneroster12 schema and supporting objects
-- =============================================

-- Create schema if not exists
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'oneroster12')
BEGIN
    EXEC('CREATE SCHEMA oneroster12');
    PRINT 'Schema oneroster12 created successfully';
END
ELSE
BEGIN
    PRINT 'Schema oneroster12 already exists';
END
GO

-- Create error logging table for refresh procedures
IF OBJECT_ID('oneroster12.refresh_errors', 'U') IS NOT NULL
    DROP TABLE oneroster12.refresh_errors;

CREATE TABLE oneroster12.refresh_errors (
    error_id INT IDENTITY(1,1) PRIMARY KEY,
    table_name NVARCHAR(128) NOT NULL,
    error_date DATETIME2 DEFAULT GETDATE(),
    error_message NVARCHAR(4000),
    error_severity INT,
    error_state INT,
    error_procedure NVARCHAR(128),
    error_line INT
);
GO

-- Create refresh history table for monitoring
IF OBJECT_ID('oneroster12.refresh_history', 'U') IS NOT NULL
    DROP TABLE oneroster12.refresh_history;

CREATE TABLE oneroster12.refresh_history (
    history_id INT IDENTITY(1,1) PRIMARY KEY,
    table_name NVARCHAR(128) NOT NULL,
    refresh_start DATETIME2 NOT NULL,
    refresh_end DATETIME2,
    row_count INT,
    status NVARCHAR(20) CHECK (status IN ('Running', 'Success', 'Failed')),
    duration_seconds AS DATEDIFF(SECOND, refresh_start, refresh_end)
);
GO

-- Create index on refresh history for monitoring queries
CREATE INDEX IX_refresh_history_table_date 
ON oneroster12.refresh_history(table_name, refresh_start DESC);
GO

PRINT 'OneRoster 1.2 MSSQL setup completed successfully';
GO