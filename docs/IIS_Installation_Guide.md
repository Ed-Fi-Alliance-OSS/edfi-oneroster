# Ed-Fi OneRoster IIS Installation Guide

This document describes the supported Windows deployment model: IIS as a reverse
proxy (ARR + URL Rewrite) and Node.js running as a separate process managed by
WinSW.

## Table of Contents

- [Ed-Fi OneRoster IIS Installation Guide](#ed-fi-oneroster-iis-installation-guide)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
    - [System Requirements](#system-requirements)
    - [Required IIS Components](#required-iis-components)
    - [Network and Database Requirements](#network-and-database-requirements)
  - [Deployment Folder Layout](#deployment-folder-layout)
  - [Application Setup](#application-setup)
    - [Download Application](#download-application)
    - [Configure Environment Files](#configure-environment-files)
    - [Database Setup](#database-setup)
    - [Build and Local Runtime Verification](#build-and-local-runtime-verification)
  - [IIS Reverse Proxy Setup for Node.js](#iis-reverse-proxy-setup-for-nodejs)
    - [Architecture](#architecture)
    - [Step 1: Enable ARR Proxy](#step-1-enable-arr-proxy)
    - [Step 2: Create IIS Website](#step-2-create-iis-website)
    - [Step 3: Configure web.config for Reverse Proxy](#step-3-configure-webconfig-for-reverse-proxy)
    - [Step 4: Allow Server Variables](#step-4-allow-server-variables)
    - [Step 5: Verify Reverse Proxy](#step-5-verify-reverse-proxy)
  - [Running Node.js as a Windows Service using WinSW](#running-nodejs-as-a-windows-service-using-winsw)
    - [Step 1: Install WinSW Binary](#step-1-install-winsw-binary)
    - [Step 2: Create WinSW Service Definition](#step-2-create-winsw-service-definition)
    - [Step 3: Install and Start Service](#step-3-install-and-start-service)
    - [Step 4: Verify Service and Endpoints](#step-4-verify-service-and-endpoints)
    - [Useful WinSW Commands](#useful-winsw-commands)
  - [Troubleshooting](#troubleshooting)
    - [Build and Startup Issues](#build-and-startup-issues)
    - [Database Connectivity Issues](#database-connectivity-issues)
    - [Reverse Proxy Issues](#reverse-proxy-issues)
    - [WinSW Service Issues](#winsw-service-issues)

## Prerequisites

### System Requirements

- Windows Server 2016 or later (2019, 2022 recommended)
- IIS 8.5 or later
- Node.js 22.12.0 or later
- npm 9.x or later
- Administrator access to the server

### Required IIS Components

- URL Rewrite module: https://www.iis.net/downloads/microsoft/url-rewrite
- Application Request Routing (ARR): https://www.iis.net/downloads/microsoft/application-request-routing

### Network and Database Requirements

- Access to an Ed-Fi ODS database (PostgreSQL or Microsoft SQL Server)
- Database credentials
- Network connectivity to the database server
- Port 3000 available for the Node process

## Deployment Folder Layout

Use three separate folders to avoid path confusion:

Note: this guide uses `C:\apps` as an example base directory. You can substitute
your own base path consistently.

1. Application folder (OneRoster source code and .env):
  C:\apps\oneroster
2. IIS proxy folder (contains only proxy web.config):
  C:\apps\oneRosterProxy
3. WinSW service folder (contains WinSW exe/xml/logs):
  C:\services\OneRoster

## Application Setup

### Download Application

```powershell
git clone https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster.git C:\apps\oneroster
cd C:\apps\oneroster
npm install --production
```

### Configure Environment Files

Create `C:\apps\oneroster\.env` with the configuration for your deployment
mode (single-tenant or multi-tenant).

If the app is hosted under /oneroster, set API_BASE_PATH=/oneroster in .env so
discovery URLs are generated with that base path.

When running behind IIS/ARR, set TRUST_PROXY=true in .env so the app can trust
forwarded headers (e.g., for correct client IP handling in rate limiting).

Sample .env template and setup details are documented in:

- [.env.example](../.env.example)
- [docs/local-development-guide.md](local-development-guide.md)

### Database Setup

Deploy OneRoster database artifacts for your engine:

- PostgreSQL setup reference: [standard/README_pgsql.md](../standard/README_pgsql.md)
- Microsoft SQL Server setup reference: [standard/README_mssql.md](../standard/README_mssql.md)

Database object deployment scripts are in `standard/`.

### Build and Local Runtime Verification

From the application root (C:\apps\oneroster):

```powershell
npm run build
npm run start
```

Verify the application is running directly on Node:

- http://localhost:3000
- http://localhost:3000/docs
- http://localhost:3000/swagger.json
- http://localhost:3000/health-check

Only proceed to IIS setup after local verification succeeds.

## IIS Reverse Proxy Setup for Node.js

IIS terminates HTTP/HTTPS and forwards requests to the Node process running on
localhost:3000.

### Architecture

Client -> IIS (80/443) -> ARR + URL Rewrite -> Node (localhost:3000)

### Step 1: Enable ARR Proxy

1. Open IIS Manager.
2. Select the server node.
3. Open Application Request Routing Cache.
4. Select Server Proxy Settings.
5. Enable proxy, then click Apply.

### Step 2: Create IIS Website

1. In IIS Manager, select Sites -> Add Website.
2. Configure:
   - Site name: OneRosterProxy
   - Physical path: C:\apps\oneRosterProxy
   - Binding: HTTP port 8082 (or your chosen port), optional HTTPS binding on 443

### Step 3: Configure web.config for Reverse Proxy

Place this web.config in C:\apps\oneRosterProxy\web.config:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
           <rules>
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

### Step 4: Allow Server Variables

At site level in URL Rewrite -> View Server Variables, add:

- HTTP_X_FORWARDED_PROTO
- HTTP_X_FORWARDED_HOST

### Step 5: Verify Reverse Proxy

After starting Node on localhost:3000, verify through IIS:

- http://localhost:8082
- http://localhost:8082/docs
- http://localhost:8082/swagger.json
- http://localhost:8082/health-check

## Running Node.js as a Windows Service using WinSW

WinSW is the recommended process manager for long-running Node services on
Windows.

### Step 1: Install WinSW Binary

1. Download WinSW-x64.exe from https://github.com/winsw/winsw/releases
2. Create C:\services\OneRoster
3. Copy WinSW-x64.exe and rename it to OneRosterApi.exe

### Step 2: Create WinSW Service Definition

Create C:\services\OneRoster\OneRosterApi.xml:

```xml
<service>
  <id>OneRosterApi</id>
  <name>OneRoster API</name>
  <description>Node.js OneRoster API Service</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>server.js</arguments>
  <workingdirectory>C:\apps\oneroster</workingdirectory>
  <logpath>C:\services\OneRoster\logs</logpath>
  <log mode="roll" />
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec"/>
</service>
```

### Step 3: Install and Start Service

```powershell
cd C:\services\OneRoster
OneRosterApi.exe install
OneRosterApi.exe start
```

### Step 4: Verify Service and Endpoints

1. In services.msc, verify OneRosterApi is Running and Startup Type is Automatic.
2. Verify direct Node endpoint: http://localhost:3000/health-check
3. Verify IIS proxy endpoint: http://localhost:8082/health-check

### Useful WinSW Commands

```powershell
OneRosterApi.exe stop
OneRosterApi.exe start
OneRosterApi.exe restart
OneRosterApi.exe uninstall
```

## Troubleshooting

### Build and Startup Issues

- Re-run npm install --production and npm run build from app root.
- Confirm node --version is 22.12.0 or newer.
- Start locally with npm run start and verify http://localhost:3000/health-check.

### Database Connectivity Issues

- Validate DB host and credentials in .env.
- Validate port access with Test-NetConnection.
- Re-check SQL/view deployment using
  [standard/README_pgsql.md](../standard/README_pgsql.md) or
  [standard/README_mssql.md](../standard/README_mssql.md).

### Reverse Proxy Issues

- Confirm ARR proxy is enabled at server level.
- Confirm rewrite rules exist and point to http://localhost:3000/{R:1}.
- Confirm HTTP_X_FORWARDED_PROTO and HTTP_X_FORWARDED_HOST are allowed server variables.

### WinSW Service Issues

- Check logs in C:\services\OneRoster\logs.
- Confirm working directory in OneRosterApi.xml points to C:\apps\oneroster.
- Confirm node executable path is valid.
