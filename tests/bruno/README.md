# Bruno API Tests for Ed-Fi OneRoster

This directory contains Bruno collections and scripts for running end-to-end
(E2E) API tests against the Ed-Fi OneRoster stack.

## Prerequisites

- Node.js (v18 or higher recommended)
- Bruno CLI (`@usebruno/cli`) installed globally or ad-hoc (see below)
- Docker and Docker Compose (for running the stack)
- PowerShell (for running the automation script)

## Directory Structure

- `bruno.json` — Bruno collection root file
- `tests/` — Bruno test cases for OneRoster endpoints
- `environments/` — Bruno environment files (e.g., `ci.bru`)
- `run-bruno-e2e.ps1` — PowerShell script to automate environment setup, health
  checks, test execution, and cleanup

## How to Run the E2E Tests

### 1. Install Dependencies

From the project root:

```powershell
npm install
```

#### Bruno CLI Installation (choose one):

- **Global install (recommended for local use):**

  ```powershell

  npm install -g @usebruno/cli

  ```

  Then use `bru` or `npx bru` in any terminal.

### 2. Run the E2E Test Script

From the project root, run the PowerShell script:

```pwsh
 ./tests/bruno/run-bruno-e2e.ps1 -Version 5.2.0 -NeedEnvironmentSetup
```

- `-Version` can be `5.2.0` or `4.0.0` (corresponds to the environment and stack
  version)
- `-NeedEnvironmentSetup` (optional) will start/initialize the Docker stack and
  wait for services to be healthy before running tests

### 3. What the Script Does

- Sets up environment variables and keys
- Starts Docker containers for the Ed-Fi OneRoster stack
- Waits for API endpoints to be healthy
- Runs all Bruno tests in the collection using the correct environment
- Stops and cleans up all services after tests complete

### Run Bruno Tests Manually (Docker Environment)

> **Note:** All required environment setup (databases, Docker containers,
> environment files, and any necessary configuration) must be in place and
> running before executing the tests. The PowerShell script automates this, but
> if running manually, ensure all dependencies are started and configured.

If you want to run Bruno tests directly (without the PowerShell script):

```powershell
cd tests/bruno
bru run . --env-file environments/local.bru -r
# Or, if bru is not installed globally:
npx bru run . --env-file environments/local.bru -r
```

## Running the Application Locally (Host Machine) and Using Bruno

You can run the Ed-Fi OneRoster application stack locally on your host machine
(outside Docker) for development and testing. In this case, you must ensure all
required services (database, API, etc.) are running and accessible.

To use Bruno for API testing against your local environment:

- Edit `environments/local.bru` to set the required variables (client IDs,
  secrets, URLs, etc.).
- You can use environment variable placeholders (e.g.,
  `{{process.env.LEA_KEY}}`) or set the values directly (e.g., `leaClientId:
  "your-lea-key"`).
- If using environment variables, set them in your shell before running Bruno
  tests:

  ```powershell
  $env:LEA_KEY="your-lea-key"
  $env:LEA_SECRET="your-lea-secret"
  # ...set other variables as needed
  cd tests/bruno
  bru run . --env-file environments/local.bru -r
  ```

- If you set the values directly in `local.bru`, no environment variables are
  needed.

> **Note:**
> The `local.bru` file is not meant to be committed with secrets. Leave
> sensitive values empty or as placeholders and document for users to fill them
> in.

## Troubleshooting

- Ensure Docker is running and ports are available
- If you see 'You can run only at the root of a collection', make sure you are in the directory with `bruno.json` when running `bru`
- For CLI version issues, check your global install with `bru --version` or ensure your CI workflow installs Bruno CLI before running tests

## References

- [Bruno CLI Documentation](https://www.usebruno.com/docs/cli/overview)
- [Ed-Fi OneRoster Documentation](https://ed-fi.org/)
