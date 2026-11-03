# Azure VM Deployment Guide

This guide walks through standing up the OneRoster Docker stack on a Windows
Azure VM, fronted by NGINX with a free Let's Encrypt TLS certificate issued by
Certbot. It builds on the Docker workflow described in
[stack/README.md](../stack/README.md); read that first for an overview of the
compose files and environment variables.

## Prerequisites

- A Windows Azure VM with **Docker Desktop** (or Docker Engine + Compose) and
  **PowerShell 7+** installed.
- A public DNS name for the VM, for example
  `ed-fi-admin-app-demo.centralus.cloudapp.azure.com` (set under _VM → Overview
  → DNS name_ in the Azure portal).
- **Inbound ports 80 and 443 open** in the VM's Network Security Group (NSG)
  and in Windows Firewall. Port 80 is required by Certbot's HTTP-01 challenge;
  port 443 serves the APIs.
- **Certbot for Windows** installed on the VM (installs to `C:\Certbot` by
  default).

The examples below assume the code lives in `C:\oneroster`. Adjust paths if you
use a different folder.

## Step 1: Get the Code onto the VM

Git is not currently installed on the VM, so use one of the following options.

### Option A: Copy the Files Directly (No Git Required)

1. On your workstation, download the repository as a ZIP
   (GitHub → _Code_ → _Download ZIP_) or zip up your local clone.
2. Copy the archive to the VM (for example via RDP clipboard/drive
   redirection or Azure Storage) and extract it to `C:\oneroster`.

### Option B: Clone with Git

If Git is installed on the VM later:

```powershell
git clone https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster.git C:\oneroster
```

After either option you should have `C:\oneroster\stack\start-services.ps1`.

## Step 2: Create the SSL Certificate with Certbot

Certbot's `--standalone` mode starts its own temporary web server on port 80,
so make sure nothing else on the VM (for example IIS) is listening on port 80
while you run it. The stack's `nginx` container does not publish port 80 by
default, so it does not conflict.

Open an **elevated** PowerShell prompt and run:

```powershell
# Create a certificate
certbot certonly --standalone -d <your-domain-name> -m <your-admin-email> --agree-tos --non-interactive

# Example
certbot certonly --standalone -d ed-fi-admin-app-demo.centralus.cloudapp.azure.com -m <your-admin-email> --agree-tos --non-interactive
```

The generated files are written to:

```text
C:\Certbot\live\<your-domain-name>\
```

Useful Certbot commands:

```powershell
# List installed certificates and their expiry dates
certbot certificates

# Test renewal without changing anything
certbot renew --dry-run

# Renew certificates that are close to expiry
certbot renew

# Delete a certificate that is no longer needed
certbot delete --cert-name <your-domain-name>
```

## Step 3: Copy the Certificate Files into the Stack

The NGINX container mounts `stack/ssl` as `/ssl`. Copy the Let's Encrypt files
there:

```powershell
Copy-Item "C:\Certbot\live\<your-domain-name>\fullchain.pem" "C:\oneroster\stack\ssl\fullchain.pem" -Force
Copy-Item "C:\Certbot\live\<your-domain-name>\privkey.pem"   "C:\oneroster\stack\ssl\privkey.pem" -Force
```

> [!IMPORTANT]
> `privkey.pem` is the certificate's private key. Do not commit it to source
> control or share it.

## Step 4: Point NGINX at the Let's Encrypt Certificate

Edit `C:\oneroster\stack\settings\default.conf.template`. Comment out the
self-signed certificate lines and enable the Let's Encrypt ones, using the file
names from Step 3:

```nginx
    # Uncomment if using locally-generated self-signed certificate
    #ssl_certificate /ssl/server.crt;
    #ssl_certificate_key /ssl/server.key;

    # Uncomment if using files from Let's Encrypt
    ssl_certificate /ssl/fullchain.pem;
    ssl_certificate_key /ssl/privkey.pem;
```

Optionally, change `server_name localhost;` to your domain name.

> [!NOTE]
> The compose files publish NGINX as `'127.0.0.1:443:443'`, which only accepts
> connections from the VM itself. To reach the APIs from outside the VM, change
> the `ports` entry of the `nginx` service to `'443:443'` in the compose file you
> use (for example `stack/pgsql/single-tenant/nginx-compose.yml` or
> `stack/mssql/single-tenant/docker-compose-mssql.yml`).

## Step 5: Update the Environment File

Copy the example env file that matches your engine and Data Standard (for
example `stack/pgsql/.env.5.2.0.example`) to a new file such as
`stack/pgsql/.env`, then set `BASE_URL` to the VM's public HTTPS address:

```env
BASE_URL=https://ed-fi-admin-app-demo.centralus.cloudapp.azure.com
BASE_URL_DEV=http://localhost:3333
```

`ALLOWED_ORIGINS`, `CORS_ORIGINS`, `OAUTH2_ISSUERBASEURL`, and
`OAUTH2_AUDIENCE` are derived from `BASE_URL`, so they pick up the new domain
automatically. Review the rest of the file (credentials, keys, image tags) as
described in [stack/README.md](../stack/README.md).

## Step 6: Start the Containers

From the `stack` folder, run `start-services.ps1` with your env file:

```powershell
cd C:\oneroster\stack
./start-services.ps1 -EnvFile "pgsql/.env"
```

Common options:

- `-Rebuild` — rebuild the OneRoster image (use after changing source code).
- `-DbType Mssql` — use the SQL Server stack (default is `Postgres`).
- `-InstallType MultiTenant` — start the multi-tenant stack.
- `-InitializeAdminClients` / `-InitializeOneRosterViews` — seed bootstrap data
  and deploy the `oneroster12` views.

Once running, browse to:

- OneRoster API: `https://<your-domain-name>/<ONEROSTER_API_VIRTUAL_NAME>`
- Ed-Fi API: `https://<your-domain-name>/<ODS_API_VIRTUAL_NAME>`
- Swagger UI: `https://<your-domain-name>/<DOCS_VIRTUAL_NAME>`

Stop the stack with `./stop-services.ps1 -EnvFile "pgsql/.env"`.

## Renewing the Certificate

Let's Encrypt certificates expire after 90 days. To renew:

1. Make sure port 80 is free and run `certbot renew`.
2. Repeat the copy commands from [Step 3](#step-3-copy-the-certificate-files-into-the-stack).
3. Restart NGINX so it loads the new files: `docker restart nginx`.
