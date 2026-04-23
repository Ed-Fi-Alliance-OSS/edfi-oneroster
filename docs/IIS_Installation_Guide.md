# Ed-Fi OneRoster IIS Installation Guide

This document provides detailed instructions for installing and configuring the
Ed-Fi OneRoster application on Internet Information Services (IIS) on a Windows
Server.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Application Preparation](#application-preparation)
   - [Database Configuration](#database-configuration)
   - [Environment Configuration](#environment-configuration)
3. [IIS Configuration](#iis-configuration)
4. [Application Startup](#application-startup)
5. [SSL/TLS Setup](#ssltls-setup)
6. [Troubleshooting](#troubleshooting)
7. [IIS Reverse Proxy Setup for Node.js (Alternative to IISNode)](#iis-reverse-proxy-setup-for-nodejs-alternative-to-iisnode)
8. [Running Node.js as a Windows Service using WinSW](#running-nodejs-as-a-windows-service-using-winsw)

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
      devErrorsEnabled="false"
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

### Step 3: Database Configuration

The OneRoster API supports both **single-tenant** and **multi-tenant** deployments. Choose the configuration that matches your deployment needs.

#### Single-Tenant Mode (Default)

In single-tenant mode, the API connects to a single Ed-Fi Admin database and serves data from one or more ODS instances associated with that admin database.

**Key Concepts:**

- Set `MULTITENANCY_ENABLED=false`
- Configure `CONNECTION_CONFIG` with your EdFi_Admin database connection
- Configure `PG_BOSS_CONNECTION_CONFIG` with the PostgreSQL admin connection used by pg-boss
- The API automatically resolves ODS instances from the admin database based on API key/secret

#### Multi-Tenant Mode

In multi-tenant mode, the API supports multiple isolated tenants, each with their own Ed-Fi Admin database and ODS instances.

**Key Concepts:**

- Set `MULTITENANCY_ENABLED=true`
- Configure `TENANTS_CONNECTION_CONFIG` with a JSON object mapping tenant names to admin connections
- Configure `PG_BOSS_CONNECTION_CONFIG` explicitly (tenant admin DB, the same admin DB used by `CONNECTION_CONFIG`, or a dedicated pg-boss DB) so pg-boss storage is stable and independent
- Tenant identifier is extracted from the request URL (e.g., `/oneroster/{tenantId}/...`)
- Each tenant's data is completely isolated

#### ODS Context Routing

Enable context-based routing to serve data from different ODS instances based on contextual parameters (e.g., school year):

- Set `ODS_CONTEXT_ROUTE_TEMPLATE={schoolYearFromRoute:range(2026,2027)}`
- When enabled, requests route to different ODS instances based on the context parameter
- Leave empty to disable context routing

#### Encryption Key

The `ODS_CONNECTION_STRING_ENCRYPTION_KEY` encrypts ODS connection strings retrieved from the admin database. This value must match the Ed-Fi ODS API's `ApiSettings:OdsConnectionStringEncryptionKey` configuration.

**Generate a secure key:**

**PowerShell:**

```powershell
[Convert]::ToBase64String((New-Object byte[] 32 | ForEach-Object { [System.Security.Cryptography.RandomNumberGenerator]::Fill($_) ; $_ }))
```

**Bash/WSL:**

```bash
openssl rand -base64 32
```

#### Database Deployment

For detailed database deployment instructions:

- **PostgreSQL:** [README_pgsql.md](../standard/README_pgsql.md)
- **Microsoft SQL Server:** [README_mssql.md](../standard/README_mssql.md)

### Step 4: Environment Configuration

Create `C:\inetpub\oneroster\.env` with the appropriate configuration for your deployment mode.

>[!NOTE]
> If the app is hosted under `/oneroster`, set `API_BASE_PATH=/oneroster`
> in `.env` so discovery URLs are generated consistently with that base path.
>
> Refer to [Database Configuration](#database-configuration) above for detailed explanations of single-tenant vs multi-tenant modes, encryption keys, and ODS context routing.

**PostgreSQL - Single-Tenant Mode:**

```env
# Database Configuration
DB_TYPE=postgres
MULTITENANCY_ENABLED=false
CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=P@ssw0rd"}
ODS_CONNECTION_STRING_ENCRYPTION_KEY=

# PostgreSQL-specific settings
DB_SSL=false
DB_SSL_CA=
PG_BOSS_CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=P@ssw0rd"}
PGBOSS_CRON=*/15 * * * *

# Server Configuration
NODE_ENV=production
PORT=3000
API_BASE_PATH=
LOG_LEVEL=info

# ODS context routing (optional)
ODS_CONTEXT_ROUTE_TEMPLATE=

CORS_ORIGINS=http://localhost:3000,http://localhost:56641
TRUST_PROXY=true

# OAuth2 Configuration
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

**PostgreSQL - Multi-Tenant Mode:**

```env
# Database Configuration
DB_TYPE=postgres
MULTITENANCY_ENABLED=true
TENANTS_CONNECTION_CONFIG={"Tenant1":{"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant1;username=postgres;password=pass1"},"Tenant2":{"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant2;username=postgres;password=pass2"}}
ODS_CONNECTION_STRING_ENCRYPTION_KEY=

# PostgreSQL-specific settings
DB_SSL=false
DB_SSL_CA=
PG_BOSS_CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant1;username=postgres;password=pass1"}
PGBOSS_CRON=*/15 * * * *

# Server Configuration
NODE_ENV=production
PORT=3000
API_BASE_PATH=
LOG_LEVEL=info

# ODS context routing (optional)
ODS_CONTEXT_ROUTE_TEMPLATE={schoolYearFromRoute:range(2026,2027)}

CORS_ORIGINS=http://localhost:3000,http://localhost:56641
TRUST_PROXY=true

# OAuth2 Configuration
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

**Microsoft SQL Server - Single-Tenant Mode:**

```env
# Database Configuration
DB_TYPE=mssql
MULTITENANCY_ENABLED=false
CONNECTION_CONFIG={"adminConnection":"server=localhost;database=EdFi_Admin;user id=sa;password=yourStrong(!)Password;encrypt=false;TrustServerCertificate=true"}
ODS_CONNECTION_STRING_ENCRYPTION_KEY=

# Server Configuration
NODE_ENV=production
PORT=3000
API_BASE_PATH=
LOG_LEVEL=info

# ODS context routing (optional)
ODS_CONTEXT_ROUTE_TEMPLATE=

CORS_ORIGINS=http://localhost:3000,http://localhost:56641
TRUST_PROXY=true

# OAuth2 Configuration
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

**Microsoft SQL Server - Multi-Tenant Mode:**

```env
# Database Configuration
DB_TYPE=mssql
MULTITENANCY_ENABLED=true
TENANTS_CONNECTION_CONFIG={"Tenant1":{"adminConnection":"server=localhost;database=EdFi_Admin_Tenant1;user id=sa;password=pass1;encrypt=false"},"Tenant2":{"adminConnection":"server=localhost;database=EdFi_Admin_Tenant2;user id=sa;password=pass2;encrypt=false"}}
ODS_CONNECTION_STRING_ENCRYPTION_KEY=

# Server Configuration
NODE_ENV=production
PORT=3000
API_BASE_PATH=
LOG_LEVEL=info

# ODS context routing (optional)
ODS_CONTEXT_ROUTE_TEMPLATE={schoolYearFromRoute:range(2026,2027)}

CORS_ORIGINS=http://localhost:3000,http://localhost:56641
TRUST_PROXY=true

# OAuth2 Configuration
OAUTH2_ISSUERBASEURL=http://localhost:54746
OAUTH2_AUDIENCE=http://localhost:3000
OAUTH2_TOKENSIGNINGALG=RS256
OAUTH2_PUBLIC_KEY_PEM=
```

### Step 5: Validate folder structure

```
C:\inetpub\oneroster\
├── src/
├── config/
├── node_modules/        (created during npm install)
├── scripts/
├── server.js
├── package.json
├── package-lock.json
├── web.config           (created in Step 2)
└── .env                 (created in Step 4)
```

### Step 6: Security Considerations for .env

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
   - **Regular Time Interval (minutes)**: `0` (prevents
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

### Step 4: Verify Handler Mappings

The bundled `web.config` already wires up the `iisnode` handler and rewrite
rules. Rather than creating a new handler via IIS Manager, simply confirm the
existing entry remains in place:

1. Open **IIS Manager** as Administrator
2. Navigate to your website (`oneroster`) → **Handler Mappings**
3. Verify a handler named `iisnode` appears with **Path** `server.js`; IIS lists
  it as coming from `web.config`. If it is present, no further action is
  required
4. Only environments where server policies strip handler definitions from
  `web.config` need a manual mapping; otherwise rely on the configuration that
  ships with the application

### Step 5: Add HTTP_X_FORWARDED_PROTO and HTTP_X_FORWARDED_HOST

These headers allow the Node application to detect the original request protocol
and host, ensuring it generates correct URLs (e.g., https instead of http).

1. Open IIS Manager and navigate to your website
2. In the middle pane, double-click URL Rewrite
3. In the right-hand panel, click View Server Variables
4. Click Add…, then add: `HTTP_X_FORWARDED_PROTO`, `HTTP_X_FORWARDED_HOST`
5. Confirm that both variables appear in the list.

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
# Test the health endpoint (replace 'localhost' with your configured host name if different)
Invoke-WebRequest -Uri "http://localhost/health-check" -UseBasicParsing
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

Update `web.config` temporarily (development only):

```xml
<iisnode
  loggingEnabled="true"
  devErrorsEnabled="true"
  debuggingEnabled="true" />
```

1. Save `web.config` with the settings above.
2. Run `iisreset` (or recycle the site’s app pool) so  IIS reloads the updated
   configuration.
3. Revert the values (`devErrorsEnabled="false"`, `debuggingEnabled="false"`)
   before returning to production.

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

    - `Preload Enabled` → True
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
```

## IIS Reverse Proxy Setup for Node.js (Alternative to IISNode)

This setup runs the Node.js application as a separate process and uses IIS as a
reverse proxy to handle HTTP/HTTPS traffic.

### Overview

Instead of hosting Node inside IIS (iisnode), this approach:

Runs Node independently (e.g., on http://localhost:3000)

Uses IIS to:

- Terminate SSL (HTTPS) (The HTTPS (encrypted connection) is handled by IIS, and
  IIS forwards the request to your Node app as plain HTTP)
- Route incoming requests
- Forward traffic to Node via `Application Request Routing (ARR)`

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

**Option A**: Using UI

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
   HTTP_X_FORWARDED_HOST (see [Add HTTP_X_FORWARDED_PROTO and
   HTTP_X_FORWARDED_HOST](#step-5-add-http_x_forwarded_proto-and-http_x_forwarded_host))

### Step 6: Run Node Application

```powershell
cd "<application root folder>"
npm start
```

### Step 7: Verify Setup

http://localhost:8082 

http://localhost:8082/docs

http://localhost:8082/swagger.json
  
## Running Node.js as a Windows Service using WinSW

### Alternative Options

Other tools are available to run Node.js as a Windows Service, such as:

1. NSSM (Non-Sucking Service Manager) – simple and widely used, but no longer
   actively maintained

2. PM2 (Windows support) – useful for process management, but less native to
   Windows services

While these options can work, they are either legacy or less suitable for
long-term production use on Windows.

#### Recommended Approach

For this setup, WinSW (Windows Service Wrapper) is recommended because it is:

1. Actively maintained
2. More robust and production-ready
3. Configurable using a simple XML file
4. Better suited for long-running services

WinSW (Windows Service Wrapper) allows a Node.js application to run as a Windows
Service, ensuring it:

1. Starts automatically on system boot
2. Runs continuously in the background
3. Restarts automatically on failure

This is the recommended approach when using IIS as a reverse proxy instead of
IISNode.

### Steps for setting up the WinSW service

1. Download the latest WinSW-x64.exe release from:
   https://github.com/winsw/winsw/releases
2. Create a dedicated folder for the service, example: C:\services\oneroster-api
3. Copy the downloaded file (WinSW-x64.exe) and rename it: OneRosterApi.exe
4. Create a file with the same name as the executable: OneRosterApi.xml

   ```xml
    <service>
      <id>OneRosterApi</id>
      <name>OneRoster API</name>
      <description>Node.js OneRoster API Service</description>
      <executable>C:\Program Files\nodejs\node.exe</executable>
      <arguments>server.js</arguments>
      <workingdirectory>C:\apps\oneroster-api</workingdirectory> <!-- Path to OneRoster API files -->
      <logpath>C:\services\oneroster-api\logs</logpath>
      <log mode="roll" />
      <startmode>Automatic</startmode>
      <onfailure action="restart" delay="10 sec"/>
   </service>
   ```

5. Open PowerShell as Administrator:

   ```powershell
   cd C:\services\oneroster-api
   OneRosterApi.exe install

   OneRosterApi.exe start
   ```

6. Verify the service:
  
   - Open Services (services.msc)
   - Locate OneRosterApi, the status should be running and startup type should
     be `Automatic`
  
7. Test Application:
   - Verify the Node app: http://localhost:3000
   - Then verify via IIS reverse proxy: http://localhost:8082
  
 >[!NOTE]
 > Ensure Node.js is installed and available at: C:\Program Files\nodejs\node.exe.
 > Use absolute paths for all configurations.
 > Ensure the logs directory exists: C:\services\oneroster-api\logs
  
### Useful commands

  ```powershell

  OneRosterApi.exe stop
  OneRosterApi.exe start
  OneRosterApi.exe restart
  OneRosterApi.exe uninstall
  ```

### Recommended Architecture

 Client → IIS (HTTPS) → Reverse Proxy (ARR) → Node (WinSW Service)
