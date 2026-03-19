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
8. [Troubleshooting](#troubleshooting)
9. [IIS Reverse Proxy Setup for Node.js (Alternative to IISNode)](#iis-reverse-proxy-setup-for-nodejs-alternative-to-iisnode)

## Prerequisites

### System Requirements

- **Windows Server 2016** or later (2019, 2022 recommended)
- **IIS 8.5** or later
- **Node.js** 18.x or later (LTS version recommended)
- **npm** 9.x or later (included with Node.js)
- **Administrator access** to the server

### Required IIS Components

- **iisnode**: For running Node.js applications in IIS - Install from [GitHub
  Releases](https://github.com/Azure/iisnode/releases)
- **URL Rewrite** module (required for Node.js routing) - Install from
  [Microsoft](https://www.iis.net/downloads/microsoft/url-rewrite)

#### Install Required Components

1. **Install iisnode**:
   - Download the latest iisnode installer from [GitHub
     Releases](https://github.com/Azure/iisnode/releases)
   - Run the installer to integrate iisnode with IIS
   - Restart IIS after installation:

     ```powershell
     iisreset
     ```

2. **Verify URL Rewrite Module**:
   - Open IIS Manager
   - Select your server
   - Look for "URL Rewrite" icon
   - If not present, install from
     [Microsoft](https://www.iis.net/downloads/microsoft/url-rewrite)

### Network & Database Requirements

- Access to Ed-Fi ODS database (PostgreSQL or Microsoft SQL Server)
- Database connection credentials
- Network connectivity to the database server
- Available network port for the OneRoster API (typically 3000 or custom)

## Application Preparation

### Step 1: Download and build the Application

```powershell
git clone https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster.git C:\inetpub\oneroster
cd C:\inetpub\oneroster
npm install --production
npm run build
```

This installs all dependencies listed in `package.json`. The `--production` flag
skips dev dependencies.

### Step 2: Create Application Directory Structure

#### Configure web.config

Create `web.config` in your application root
(`C:\inetpub\oneroster\web.config`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>

    <!-- IIS Node Configuration -->
    <iisnode watchedFiles="web.config;*.js"
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
      devErrorsEnabled="true"
      idlePageOutTimePeriod="0" />

    <!-- Handler -->
    <handlers>
      <add name="iisnode" path="server.js" verb="*" modules="iisnode" resourceType="Unspecified" />
    </handlers>

    <!-- URL Rewrite Rules -->
   <rewrite>
      <rules>
        <rule name="Health Check" stopProcessing="true">
          <match url="^health-check/?$" />
          <action type="Rewrite" url="server.js" />
        </rule>

        <rule name="Node App HTTPS" stopProcessing="true">
          <match url=".*" />
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{HTTPS}" pattern="^ON$" />
          </conditions>
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
          <action type="Rewrite" url="server.js" />
        </rule>

        <rule name="Node App HTTP" stopProcessing="true">
          <match url=".*" />
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{HTTPS}" pattern="^OFF$" />
          </conditions>
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="http" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
          <action type="Rewrite" url="server.js" />
        </rule>
      </rules>
</rewrite>

    <!-- Static Files Caching -->
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

    <!-- Response Headers -->
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

#### Environment Configuration

**Create .env File**:

Create `C:\inetpub\oneroster\.env` with the following configuration:

>[!NOTE] If the app is hosted under `/oneroster`, set `API_BASE_PATH=/oneroster`
> in `.env` so discovery URLs are generated consistently with that base path.

**PostgreSQL Example**:

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
API_BASE_PATH=
LOG_LEVEL=info

# pg-boss settings:
PGBOSS_CRON=*/15 * * * *

CORS_ORIGINS=http://localhost:3000,http://localhost:56641

TRUST_PROXY=true

# OAuth2 settings - these must be filled out!
# (except for local testing - if blank, there's no auth, all requests will succeed)
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

**Microsoft SQL Server Example**:

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
API_BASE_PATH=
LOG_LEVEL=info

# pg-boss settings:
PGBOSS_CRON=*/15 * * * *

CORS_ORIGINS=http://localhost:3000,http://localhost:56641

TRUST_PROXY=true

# OAuth2 settings - these must be filled out!
# (except for local testing - if blank, there's no auth, all requests will succeed)
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

#### Validate folder structure

```
C:\inetpub\oneroster\
├── src/
├── config/
├── node_modules/        (created during npm install)
├── scripts/
├── server.js
├── package.json
├── package-lock.json
├── web.config           (created in Configure web.config)
└── .env                 (created in environment configuration)
```

## IIS Configuration

### Step 1: Create Application Pool

1. Open **IIS Manager**
2. Navigate to **Application Pools**
3. Click **Add Application Pool** in the Actions pane
4. Configure:
   - **Name**: `OneRosterPool`
   - **.NET CLR version**: **No Managed Code** (important for Node.js)
   - **Managed pipeline mode**: Integrated
5. Click **OK**

6. **Advanced Settings** (right-click the pool → Advanced Settings):
   - **Start Mode**: `AlwaysRunning` (recommended for production)
   - **Identity**: `ApplicationPoolIdentity` (or custom account with appropriate
     permissions)
   - **Idle Time-out (minutes)**: `0` (prevents app from stopping)
   - **Regular Time Interval (minutes)**: `1740` (29 hours - prevents
     unnecessary recycles)

### Step 2: Create Dedicated IIS Website

1. In **IIS Manager**, right-click **Sites** → **Add Website...**
2. Configure the new site:
  
     - **Site name**: `OneRoster`
     - **Application Pool**: Select `OneRosterPool` (created above)
     - **Physical path**: `C:\inetpub\oneroster`
     - **Binding**: `http`, **Port**: `80` (or another unused port)
     - **Host name**: `oneroster` (or a DNS name dedicated to this API)
  
3. Click **OK** to create the site. If you use a host name such as `oneroster`
   on a single server, add a matching DNS record or a hosts-file entry (e.g.,
   `127.0.0.1   oneroster`) so browsers can resolve it.
4. Remove any legacy virtual directory mappings under **Default Web Site** to
   avoid duplicate routes.

### Step 3: Set Directory Permissions

The IIS application pool identity must have read/write access to the application
directory.

**Using PowerShell as Administrator:**

```powershell
# Set appropriate permissions
$appPath = "C:\inetpub\oneroster"
$iisAppPool = "OneRosterPool"  # match the pool created in Step 1

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
3. Enter: `IIS AppPool\OneRosterPool` (or your custom app pool)
4. Click **Check Names** → **OK**
5. Select the user and assign **Modify** permissions
6. Apply and close

### Step 4: Configure Handler Mappings in IIS Manager

Since handler configuration in web.config may be restricted by IIS security
policies, configure handlers through IIS Manager:

1. Open **IIS Manager** as Administrator
2. Navigate to your website (`oneroster`)
3. Double-click **"Handler Mappings"**
4. Click **"Add Module Mapping..."**
5. Configure:
   - **Request path**: `*`
   - **Module**: Select `iisnode`
   - **Executable**: (leave empty)
   - **Name**: `iisnode`
   - **Uncheck** "Invoke handler only if request is mapped to: File or Folder"
6. Click **OK**
7. **Important**: Click `View Ordered List` and use the **"Move Up"** button to
   move this handler to the **top** of the list (above StaticFile handler)

### Step 5: Add HTTP_X_FORWARDED_PROTO and HTTP_X_FORWARDED_HOST

These headers allow the Node application to detect the original request protocol
and host, ensuring it generates correct URLs (e.g., https instead of http).

1. Open IIS Manager and navigate to your website
2. In the middle pane, double-click URL Rewrite
3. In the right-hand panel, click View Server Variables
4. Click Add…, then add: `HTTP_X_FORWARDED_PROTO`, `HTTP_X_FORWARDED_HOST`
5. Confirm that both variables appear in the list.

## Database Configuration

### For PostgreSQL

Please refer [README_pgsql.md](../standard/README_pgsql.md) for database setup

### For Microsoft SQL Server

Please refer [README_mssql.md](../standard/README_mssql.md) for database setup

### Security Considerations for .env

1. **Set appropriate file permissions**:

   ```powershell
   $envPath = "C:\inetpub\oneroster\.env"
   icacls $envPath /inheritance:r
   icacls $envPath /grant:r "SYSTEM:(F)"
   icacls $envPath /grant:r "Administrators:(F)"
   icacls $envPath /grant:r "IIS AppPool\OneRosterPool:(F)"
   ```

2. **Prevent .env from being served via HTTP**:
   - The `web.config` above includes restrictions for `.env` files

## Application Startup

### Verify Installation

Ensure your IIS directory structure is complete:

```
C:\inetpub\oneroster\
├── server.js
├── package.json
├── package-lock.json
├── web.config
├── iisnode.yml (optional)
├── .env
├── node_modules\
├── src\
├── config\

```

### Automatic Startup (Recommended)

With iisnode, the application starts automatically when IIS receives the first
request.

**Verify Configuration:**

1. **IIS Manager** → **Application Pools** → **OneRosterPool**
2. Right-click → **Advanced Settings**
3. Ensure:
   - **Start Mode**: `AlwaysRunning`
   - **.NET CLR version**: `No Managed Code`

### Warm-up the Application

After deployment, make a request to initialize the application:

```powershell
# Test the health endpoint
Invoke-WebRequest -Uri "http://localhost/oneroster/health-check" -UseBasicParsing
```

### Monitor Application Logs

Check iisnode logs for startup issues:

```powershell
# View latest log file
Get-Content C:\inetpub\oneroster\logs\*.log -Tail 50
```

## SSL/TLS Setup

### Enable HTTPS

To enable HTTPS for the Web API hosted on Internet Information Services (IIS),
install or import an SSL certificate on the server and configure an HTTPS
binding (port 443) for the site in IIS Manager. Once configured, the API
endpoints can be accessed using https://.

## Troubleshooting

### Common Issues

#### 1. HTTP 500 Errors

**Check iisnode logs:**

```powershell
Get-Content C:\inetpub\oneroster\logs\*.log -Tail 100
```

**Common causes:**

- Missing `node_modules` - Run `npm install`
- Incorrect `.env` configuration
- Database connection issues
- Node.js not in system PATH

#### 2. HTTP 404 Errors

**Check URL Rewrite:**

- Ensure URL Rewrite module is installed
- Verify `web.config` rewrite rules are correct
- Check IIS Manager → URL Rewrite → View rules

#### 3. Handler Mapping Issues

**Verify iisnode handler:**

- Open IIS Manager → Your site → Handler Mappings
- Ensure `iisnode` handler exists with path `*`
- Ensure it's at the TOP of the handler list

#### 4. Permission Denied Errors

**Grant app pool permissions:**

```powershell
$appPath = "C:\inetpub\oneroster"
$appPool = "OneRosterPool"
icacls $appPath /grant "IIS AppPool\${appPool}:(OI)(CI)F" /T
```

#### 5. Database Connection Failures

**Test database connectivity:**

```powershell
# For PostgreSQL
Test-NetConnection -ComputerName your-db-host -Port 5432

# For MSSQL
Test-NetConnection -ComputerName your-db-host -Port 1433
```

**Check `.env` file:**

- Verify credentials are correct
- Ensure connection string format is valid
- Check if database server allows remote connections

#### 6. Enable Detailed Error Messages (Development Only)

Update `web.config` temporarily:

  Select-Object -First 1 | Get-Content -Tail 50

### Monitor logs in real-time

```powershell

Get-Content C:\inetpub\oneroster\logs\*.log -Wait -Tail 10
```

### IISNode “App Goes Idle / Sleeps” – Configuration Checklist

1. Application Pool Settings

    Open IIS Manager → Application Pools → Your App Pool → Advanced Settings

    Set the following:

    - Start Mode → AlwaysRunning
    - Idle Time-out (minutes) → 0 (disables idle shutdown)
    - Idle Time-out Action (if available) → Terminate
    - Regular Time Interval (minutes) → 0 (disables periodic recycle)

    This ensures IIS does not stop or recycle the worker process due to inactivity.

2. Website / Application Settings

    Open IIS Manager → Sites → Your Site → Advanced Settings

    - Preload Enabled → True
    This allows IIS to proactively start the application instead of waiting for the first request.

3. IISNode Configuration (web.config)

    Ensure no aggressive idle behavior:

    ```xml
    <iisnode
      loggingEnabled="true"
      devErrorsEnabled="true"
      idlePageOutTimePeriod="0" /> <!--Prevents Node process from being paged out of memory.-->
    ```

### Restart Application

```powershell
# Restart IIS
iisreset

# Or restart just the app pool
Restart-WebAppPool -Name "OneRosterPool"

# Or touch web.config to trigger reload
(Get-Item C:\inetpub\oneroster\web.config).LastWriteTime = Get-Date
```

## IIS Reverse Proxy Setup for Node.js (Alternative to IISNode)

This setup runs the Node.js application as a separate process and uses IIS as a
reverse proxy to handle HTTP/HTTPS traffic.

### Overview

Instead of hosting Node inside IIS (iisnode), this approach:

Runs Node independently (e.g., on http://localhost:3000)

Uses IIS to:

- Terminate SSL (HTTPS) (The HTTPS (encrypted connection) is handled by IIS, and
  IIS forwards the request to your Node app as plain HTTP.)
- Route incoming requests
- Forward traffic to Node via Application Request Routing (ARR)

### Architecture

Client → IIS (80/443) → ARR + URL Rewrite → Node (localhost:3000)

### Step 1: Install Required IIS Modules

Install the following:

1. URL Rewrite Module Download: [URL
   Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
2. Application Request Routing (ARR) Download:
   [ARR](https://www.iis.net/downloads/microsoft/application-request-routing)
3. Verify Installation: In IIS Manager, You should see:

- URL Rewrite
- Application Request Routing Cache

### Step 2: Enable Proxy in ARR

1. Open IIS Manager
2. Click the Server node (top level)
3. Open Application Request Routing Cache
4. Click Server Proxy Settings (right panel)
5. Enable: ✔ `Enable proxy` then click `Apply`

### Step 3: Create IIS Website

1. Go to Sites → Add Website
2. Provide
   - Site name: e.g., NodeProxy
   - Physical path: e.g., C:\inetpub\node-proxy
   - Binding: HTTP → port 8082 (or 80) HTTPS → port 443 (optional) **The
      physical path is just a placeholder for web.config**

### Step 4: Configure Reverse Proxy Rule

**Option A**: Using UI (Recommended)

1. Select your IIS site
2. Open URL Rewrite
3. Click Add Rule(s)…
4. Choose `Reverse Proxy`
5. Enter backend URL: http://localhost:3000
6. Click OK (If prompted → click Yes to enable proxy)

**Option B**: Manual web.config

Place this in your site’s C:\inetpub\node-proxy\web.config:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>

        <!-- HTTPS requests -->
        <rule name="ReverseProxyHttps" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="^ON$" />
          </conditions>
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
          <action type="Rewrite" url="http://localhost:3000/{R:1}" appendQueryString="true" />
        </rule>

        <!-- HTTP requests -->
        <rule name="ReverseProxyHttp" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="^OFF$" />
          </conditions>
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="http" />
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
          </serverVariables>
          <action type="Rewrite" url="http://localhost:3000/{R:1}" appendQueryString="true" />
        </rule>

      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

### Step 5: Allow Server Variables (Important)

In IIS Manager:

1. Open your site
2. Open URL Rewrite
3. Click View Server Variables - Add: HTTP_X_FORWARDED_PROTO,
   HTTP_X_FORWARDED_HOST Please refer Add HTTP_X_FORWARDED_PROTO and
   HTTP_X_FORWARDED_HOST step above

### Step 6: Run Node Application

```powershell
cd "<appliction root folder>"
npm start
```

### Step 6: Verify Setup

http://localhost:8082 

http://localhost:8082/docs

http://localhost:8082/swagger.json
  