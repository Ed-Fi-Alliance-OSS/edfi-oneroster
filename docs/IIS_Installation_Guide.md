# Ed-Fi OneRoster IIS Installation Guide

This document provides detailed instructions for installing and configuring the
Ed-Fi OneRoster application on Internet Information Services (IIS) on a Windows
Server.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Application Preparation](#application-preparation)
3. [IIS Configuration](#iis-configuration)
4. [Database Configuration](#database-configuration)
5. [Environment Configuration](#environment-configuration)
6. [Application Startup](#application-startup)
7. [SSL/TLS Setup](#ssltls-setup)
8. [Test API Endpoints](#test-api-endpoints)

## Prerequisites

### System Requirements

- **Windows Server 2016** or later (2019, 2022 recommended)
- **IIS 8.5** or later
- **Node.js** 18.x or later (LTS version recommended)
- **npm** 9.x or later (included with Node.js)
- Administrator access to the server

### Network & Database Requirements

- Access to Ed-Fi ODS database (PostgreSQL or Microsoft SQL Server)
- Database connection credentials
- Network connectivity to the database server
- Available network port for the OneRoster API (typically 3000 or custom)

### Required IIS Components

- **IIS Core** features
- **Application Development** → **CGI**
- **URL Rewrite** module (required for Node.js routing)
- **Windows Authentication** (if needed)
- **WebSocket Protocol** support (optional, for real-time features)

## Application Preparation

### Step 1: Clone or Download the Application

Use one of these methods:

#### Option A: Using Git

```powershell
git clone https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster.git C:\inetpub\wwwroot\oneroster
cd C:\inetpub\wwwroot\oneroster
```

#### Option B: Manual Download

1. Download the application source code
2. Extract to: `C:\inetpub\wwwroot\oneroster`

### Step 2: Create Application Directory Structure

```

C:\inetpub\wwwroot\oneroster\
├── src/
├── config/
├── node_modules/        (created during npm install)
├── server.js
├── package.json
├── package-lock.json
├── web.config           (created in IIS configuration)
└── .env                 (created in environment setup)
```

### Step 3: Set Directory Permissions

The IIS application pool identity must have read/write access to the application
directory.

**Using PowerShell as Administrator:**

```powershell
# Set appropriate permissions
$appPath = "C:\inetpub\wwwroot\oneroster"
$iisAppPool = "DefaultAppPool"  # or your custom app pool name

# Get the app pool identity
$appPoolIdentity = "IIS AppPool\$iisAppPool"

# Set permissions
icacls $appPath /grant "${appPoolIdentity}:(OI)(CI)F" /T /C

# Verify permissions
icacls $appPath
```

#### Using GUI

1. Right-click application folder → **Properties** → **Security** tab
2. Click **Edit** → **Add**
3. Enter: `IIS AppPool\DefaultAppPool` (or your custom app pool)
4. Click **Check Names** → **OK**
5. Select the user and assign **Modify** permissions
6. Apply and close

### Step 4: Install Application Dependencies

```powershell
cd C:\inetpub\wwwroot\oneroster
npm install --production
```

This installs all dependencies listed in `package.json`. The `--production` flag
skips dev dependencies.

## IIS Configuration

### Step 1: Application Pool

Please create application pool (ex: OneRoster) and configure as needed.

### Step 2: Create IIS Application

1. In **IIS Manager**, expand your server → **Sites**
2. Right-click **Default Web Site** (or your custom site) → **Add Application**
3. Configure:
   - **Alias**: `oneroster` (URL will be: `http://servername/oneroster`)
   - **Application Pool**: Select `OneRosterPool` (created above)
   - **Physical path**: `C:\inetpub\wwwroot\oneroster`
4. Click **OK**

### Step 3: Configure web.config

Create or update `web.config` in your application root
(`C:\inetpub\wwwroot\oneroster\web.config`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    
    <!-- IIS Node Configuration -->
    <iisnode watchedFiles="web.config,*.js" 
             nodeProcessCountPerApplication="1"
             maxConcurrentRequestsPerProcess="1024"
             maxNamedPipeConnectionRetry="100"
             initialRequestBufferSize="4096"
             maxRequestBufferSize="65536"
             uncFileChangesPollingInterval="5000"
             gracefulShutdownTimeout="60000"
             loggingEnabled="true"
             logDirectory=".\logs"
             debuggingEnabled="false"
             devErrorsEnabled="false" />

    <!-- URL Rewrite Rules -->
    <rewrite>
      <rules>
        <!-- Health Check Endpoint -->
        <rule name="Health Check" patternSyntax="Wildcard">
          <match url="*" />
          <conditions>
            <add input="{REQUEST_URI}" pattern="/health" />
          </conditions>
          <action type="Rewrite" url="server.js" />
        </rule>
        
        <!-- API Routes -->
        <rule name="OneRoster API" patternSyntax="Wildcard">
          <match url="*" />
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="server.js" />
        </rule>
      </rules>
    </rewrite>

    <!-- Static Files Caching (optional) -->
    <staticContent>
      <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" />
    </staticContent>

    <!-- Request Filtering -->
    <security>
      <requestFiltering>
        <fileExtensions>
          <add fileExtension=".env" allowed="false" />
          <add fileExtension=".yml" allowed="false" />
          <add fileExtension=".yaml" allowed="false" />
        </fileExtensions>
      </requestFiltering>
    </security>

    <!-- Response Headers (optional security headers) -->
    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="SAMEORIGIN" />
        <add name="X-XSS-Protection" value="1; mode=block" />
      </customHeaders>
    </httpProtocol>

  </system.webServer>
</configuration>
```

Place this file at: `C:\inetpub\wwwroot\oneroster\web.config`

## Database Configuration

### For PostgreSQL

1. Install PostgreSQL client tools (psql) on the server if not already present
2. Verify database connectivity:

   ```powershell
   # Test connection (if psql is installed)
   psql -h {DATABASE_HOST} -U {DATABASE_USER} -d {DATABASE_NAME} -c "SELECT version();"
   ```

3. Prepare database views and supporting objects using the SQL scripts in
   `/sql/pgsql/` or `/standard/{version}/pgsql/artifacts/`:
   - Run `00_setup.sql`
   - Run `01_descriptors.sql`
   - Run `02_descriptorMappings.sql`
   - Run core implementation scripts (academic_sessions.sql, classes.sql, etc.)
   - Verify pg-boss is configured if job scheduling is needed

### For Microsoft SQL Server

1. Verify SQL Server connectivity:

   ```powershell
   # Test connection with sqlcmd
   sqlcmd -S {SERVER_NAME} -U {USERNAME} -P {PASSWORD} -Q "SELECT @@VERSION;"
   ```

2. Deploy database objects using scripts in
   `/standard/{version}/artifacts/mssql/`:
   - Run `00_setup.sql` - Creates schema and infrastructure
   - Run `01_descriptors.sql` - Creates descriptor definitions
   - Run `02_descriptorMappings.sql` - Creates descriptor mappings
   - Run core implementation scripts
   - Deploy SQL Server Agent jobs for automated refresh:
     - Run `orchestration/sql_agent_job.sql`
     - Configure SQL Server Agent to run the refresh job (typically every 15
       minutes)

3. Verify SQL Server Agent is running:

   ```powershell
   # Check SQL Server Agent status
   Get-Service SQLSERVERAGENT
   
   # Start if not running
   Start-Service SQLSERVERAGENT
   ```

## Environment Configuration

### Create .env File

Create `C:\inetpub\wwwroot\oneroster\.env` with the following configuration:

#### PostgreSQL Example

```env

# Database Configuration
DB_TYPE=postgres
DB_HOST=your-postgres-host.com
DB_PORT=5432
DB_NAME=your_oneroster_database
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_SSL=false
DB_SSL_CA=

# Server Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# pg-boss settings:
PGBOSS_CRON=*/15 * * * *

CORS_ORIGINS=http://localhost:3000,http://localhost:56641

# OAuth2 settings - these must be filled out!
# (except for local testing - if blank, there's no auth, all requests will succeed)
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

#### Microsoft SQL Server Example

```env
# Database Configuration
DB_TYPE=mssql
MSSQL_SERVER=localhost
MSSQL_DATABASE=sql-database
MSSQL_USER=username
MSSQL_PASSWORD=password
MSSQL_ENCRYPT=false
MSSQL_TRUST_SERVER_CERTIFICATE=true

# Server Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# pg-boss settings:
PGBOSS_CRON=*/15 * * * *

CORS_ORIGINS=http://localhost:3000,http://localhost:56641

# OAuth2 settings - these must be filled out!
# (except for local testing - if blank, there's no auth, all requests will succeed)
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

### Security Considerations for .env

1. **Set appropriate file permissions**:

   ```powershell
   $envPath = "C:\inetpub\wwwroot\oneroster\.env"
   icacls $envPath /inheritance:r
   icacls $envPath /grant:r "SYSTEM:(F)"
   icacls $envPath /grant:r "Administrators:(F)"
   icacls $envPath /grant:r "IIS AppPool\OneRosterPool:(F)"
   ```

2. **Prevent .env from being served via HTTP**:
   - The `web.config` above includes restrictions for `.env` files

## Application Startup

### Option 1: Automatic Startup (Recommended)

The application will start automatically when IIS starts if configured in the
app pool.

**Verify in IIS Manager:**

1. Application Pools → Your Pool (OneRosterPool)
2. Right-click → Advanced Settings
3. Ensure **Start Mode** is set to **AlwaysRunning**

### Option 2: Manual Startup via Command Line

```powershell
cd C:\inetpub\wwwroot\oneroster
npm start
```

Or directly:

```powershell

node C:\inetpub\wwwroot\oneroster\server.js
```

## SSL/TLS Setup

### Enable HTTPS

To enable HTTPS for the Web API hosted on Internet Information Services (IIS),
install or import an SSL certificate on the server and configure an HTTPS
binding (port 443) for the site in IIS Manager. Once configured, the API
endpoints can be accessed using https://.

**Redirect HTTP to HTTPS** (optional but recommended):

Add this rule to `web.config`:

```xml
<rewrite>
  <rules>
    <rule name="Redirect to HTTPS" stopProcessing="true">
      <match url="(.*)" />
      <conditions>
        <add input="{HTTPS}" pattern="^OFF$" />
        <add input="{REQUEST_METHOD}" pattern="^POST$|^PUT$|^DELETE$|^PATCH$" negate="true" />
      </conditions>
      <action type="Redirect" url="https://{HTTP_HOST}{REQUEST_URI}" redirectType="Permanent" />
    </rule>
  </rules>
</rewrite>
```

## Test API Endpoints

### Health Check

```powershell
$response = Invoke-WebRequest -Uri "http://localhost:3000/oneroster/health" -ErrorAction SilentlyContinue
$response.StatusCode  # Should return 200
```

### OneRoster Endpoints

Test the main API endpoints:

```powershell
# Get academic sessions
$Uri = "http://localhost/oneroster/ims/oneroster/rostering/v1p2/academicSessions"
$response = Invoke-WebRequest -Uri $Uri -ErrorAction SilentlyContinue
$response.StatusCode  # Should return 200
$response.Content | ConvertFrom-Json | Format-List  # View results
```

#### With Authentication

If OAuth2 is enabled, include Bearer token:

```powershell
$headers = @{
    "Authorization" = "Bearer your-token-here"
    "Content-Type" = "application/json"
}

$Uri = "http://localhost/oneroster/ims/oneroster/rostering/v1p2/users"
$response = Invoke-WebRequest -Uri $Uri -Headers $headers
```
