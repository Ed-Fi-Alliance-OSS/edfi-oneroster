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
- `environments/` — Bruno environment files (e.g., `local.bru`)
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

- **Ad-hoc install (for CI or ephemeral environments):**
  Add this step before running tests:

  ```powershell
  npm install --no-save @usebruno/cli
  ```

  This does not modify package.json and works in CI workflows.

### 2. Run the E2E Test Script

From the project root, run the PowerShell script:

```powershell
pwsh ./tests/bruno/run-bruno-e2e.ps1 -Version 5.2.0 -NeedEnvironmentSetup
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

### 4. Run Bruno Tests Manually

>[!NOTE]
> All required environment setup (databases, Docker containers, environment files, and any necessary configuration) must be in place and running before executing the tests. The PowerShell script automates this, but if running manually, ensure all dependencies are started and configured.

If you want to run Bruno tests directly (without the PowerShell script):

```powershell
cd tests/bruno
bru run . --env-file environments/local.bru -r
# or, if not installed globally:
npx bru run . --env-file environments/local.bru -r
```

## Troubleshooting

- Ensure Docker is running and ports are available
- If you see 'You can run only at the root of a collection', make sure you are in the directory with `bruno.json` when running `bru`
- For CLI version issues, check your global install with `bru --version` or ensure your CI workflow installs Bruno CLI before running tests

## References

- [Bruno CLI Documentation](https://www.usebruno.com/docs/cli/overview)
- [Ed-Fi OneRoster Documentation](https://ed-fi.org/)
