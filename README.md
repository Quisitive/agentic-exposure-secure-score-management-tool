# Agentic Exposure and Secure Score Management Tool

Standalone service that centralizes Microsoft Defender XDR Vulnerability Management, Microsoft Secure Score, and Cloud Secure Score data into a Power BI-ready API and governed agentic orchestration pipeline.

## Application Purpose

This repository exists to give customers a single IT security health dashboard source that:

- Collects exposure and vulnerability-related metrics from Microsoft Defender APIs.
- Collects M365 Secure Score data from Microsoft Graph.
- Normalizes all upstream payloads to a stable reporting contract.
- Enriches each refresh with remediation recommendations from MCP-backed sources:
  - Microsoft Learn MCP
  - Azure MCP
  - Microsoft Sentinel
  - Microsoft Security Copilot snippets
  - Fabric MCP
  - Defender Response MCP
- Publishes data for Power BI import/refresh and optional push-dataset integration.

## Core Functions

1. Authentication and token lifecycle management using Entra app credentials.
2. Scheduled ingestion (cron) and manual on-demand refresh.
3. Data normalization across different API payload shapes.
4. Recommendation enrichment from MCP bridge providers.
5. Snapshot persistence and JSON table exports.
6. Guardrailed execution with policy checks, timeout limits, and token budgets.
7. Approval workflows (Teams webhook plus API fallback) for sensitive refresh actions.
8. Auditable event trail with strict PII masking and optional Azure Blob archival.
9. Sentinel bi-directional orchestration support for incident-triggered actions.
10. REST endpoints for Power BI, control-plane operations, and monitoring.

## Repository Layout

- src/clients: OAuth, Defender API, and Graph API clients
- src/services: Normalization, pipeline orchestration, snapshot store, Power BI export, approvals, audit, RBAC, guardrail orchestration
- src/remediation: MCP bridge client and recommendation aggregator
- src/routes: Health, Power BI, harness controls, approvals, and Sentinel integration endpoints
- scripts: PowerShell automation for Windows service and Entra enterprise app registration
- powerbi: Power Query starter script
- data: Generated snapshots and exported JSON tables

## Required Permissions

The service uses application permissions (client credentials flow). Grant only what you need.

### Microsoft Graph (Secure Score)

- API: Microsoft Graph
- Permission type: Application
- Required permission: SecurityEvents.Read.All
- Why: Reads secure score data via Graph Security API

Reference: [Get secureScore (Microsoft Graph)](https://learn.microsoft.com/graph/api/securescore-get)

### Microsoft Defender for Endpoint and Defender XDR APIs

For vulnerability and recommendation data ingestion, common minimum app permissions are:

- Vulnerability.Read.All
- SecurityRecommendation.Read.All
- Machine.ReadWrite.All (or endpoint-specific machine read access where available)

Reference examples:

- [Vulnerabilities API permissions](https://learn.microsoft.com/defender-endpoint/api/get-all-vulnerabilities)
- [Recommendations API permissions](https://learn.microsoft.com/defender-endpoint/api/get-all-recommendations)
- [Machines API permissions](https://learn.microsoft.com/defender-endpoint/api/get-machines)
- [Defender XDR API access model](https://learn.microsoft.com/defender-xdr/api-access)

Important:

- Some Defender exposure/secure score endpoints may require additional TVM or Defender-specific app permissions depending on tenant licensing and endpoint path.
- Validate final least-privilege permissions in a pre-production tenant before production rollout.

### Optional Power BI Push Dataset Permissions

Required only if POWERBI_PUSH_DATASET_URL is used:

- Service principal allowed for Power BI APIs in tenant settings.
- Workspace role for the service principal (typically Member or Contributor).
- API token/scopes capable of adding rows to the target push dataset.

### Role Needed to Grant Consent

In most customer tenants, one of the following roles is needed to grant admin consent:

- Global Administrator
- Privileged Role Administrator
- Cloud Application Administrator (depending on policy)

### Permissions Needed to Run Registration Script

The registration script uses Microsoft Graph PowerShell and requests delegated scopes:

- Application.ReadWrite.All
- AppRoleAssignment.ReadWrite.All
- Directory.Read.All

Run it with a tenant admin account that can create app registrations and grant app role assignments.

## Customer Deployment Guide

### 1) Prepare the customer tenant

Fastest end-to-end option (enterprise app registration + Windows service install):

```powershell
npm run deploy:client
```

Equivalent script with flags:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Deploy-HealthHubClient.ps1 -AppDisplayName "CustomerA Defender Health Hub" -ForceServiceReinstall
```

Option A (recommended): automate app registration and enterprise application creation.

```powershell
npm run entra:register
```

Optional parameters:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Register-HealthHubEnterpriseApp.ps1 -DisplayName "CustomerA Defender Health Hub" -SecretValidityMonths 18 -OutputEnvFilePath .\customer-a.env
```

Option B: create the app registration manually.

1. Register an Entra application.
2. Create a client secret or certificate.
3. Add required API permissions listed above.
4. Grant admin consent.
5. Record:
   - Tenant ID
   - Client ID
   - Client secret (or certificate settings if you extend auth)

### 2) Prepare host environment

Minimum host requirements:

- Node.js 18.18+
- Outbound HTTPS access to:
  - login.microsoftonline.com
  - graph.microsoft.com
  - api.security.microsoft.com
  - MCP bridge endpoint (if used)
  - Power BI endpoint (if push dataset is used)

### 3) Configure application

1. Copy environment file:

```powershell
Copy-Item .env.example .env
```

1. Set at minimum:

- TENANT_ID
- CLIENT_ID
- CLIENT_SECRET

Service-related optional variables:

- APP_BASE_DIR (auto-set by service wrapper)
- DATA_DIRECTORY (auto-set by service wrapper)

1. Configure optional integrations as needed:

- MCP_BRIDGE_URL and MCP_BRIDGE_API_KEY
- POWERBI_PUSH_DATASET_URL and POWERBI_PUSH_BEARER_TOKEN
- PII_MASKING_SALT and RETENTION_YEARS
- ENFORCE_US_RESIDENCY, AZURE_BLOB_CONNECTION_STRING, AZURE_BLOB_CONTAINER, AZURE_BLOB_REGION
- APPROVAL_TTL_MINUTES, TEAMS_APPROVAL_WEBHOOK_URL, REQUIRE_SENSITIVE_APPROVAL
- SENTINEL_BIDIRECTIONAL_ENABLED, SENTINEL_INBOUND_SECRET, SENTINEL_OUTBOUND_WEBHOOK_URL
- HARNESS_MAX_LOOP_ITERATIONS, HARNESS_MAX_EXTERNAL_CALLS, HARNESS_EXECUTION_TIMEOUT_MS, HARNESS_TOKEN_BUDGET

### 4) Install and validate

```powershell
npm install
npm run type-check
npm run build
npm run refresh:once
```

Expected result: a new snapshot is generated in data/ and refresh completes without fatal errors.

### 5) Run in customer environment

Development mode:

```powershell
npm run dev
```

Production mode:

```powershell
npm run build
npm start
```

Recommended production hosting options:

- Windows Server as native Windows Service via provided PowerShell installer
- Linux VM with systemd
- Container platform (Docker host, AKS, ACA) using Dockerfile and docker-compose.yml

Windows service install (elevated PowerShell):

```powershell
npm run service:install
```

Advanced install example:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-HealthHubWindowsService.ps1 -EnvironmentFilePath .\.env -InstallPath "C:\ProgramData\Defender-XDR-PowerBI-HealthHub" -ForceReinstall
```

Windows service uninstall:

```powershell
npm run service:uninstall
```

Skip enterprise app registration and only reinstall service with existing .env:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Deploy-HealthHubClient.ps1 -SkipEnterpriseAppRegistration -ForceServiceReinstall
```

What the service installer configures for resilience:

- WinSW service wrapper with automatic restart on failure
- Delayed auto-start on server boot
- Rolling service logs in install_path\\logs
- Health probe validation against /api/health after installation

Container deployment example:

```powershell
docker compose up -d --build
docker compose ps
```

Stop container deployment:

```powershell
docker compose down
```

### 6) Connect Power BI

Use powerbi/power-query-sample.m and map tables:

- ProgramInitiatives
- TopInitiatives
- SecureScores
- VulnerabilityOverview
- RemediationRecommendations

Primary API base URL: `http://your-server-or-ip:4010/api/powerbi`

## API Endpoints

Power BI endpoints:

- GET /api/powerbi/overview
- GET /api/powerbi/program-initiatives
- GET /api/powerbi/top-initiatives
- GET /api/powerbi/secure-scores
- GET /api/powerbi/vulnerability-overview
- GET /api/powerbi/remediation-recommendations
- GET /api/powerbi/full-snapshot

Operational endpoints:

- GET /api/health
- POST /api/admin/refresh

Harness and approval endpoints:

- GET /api/harness/status
- POST /api/harness/refresh
- GET /api/approvals/pending
- POST /api/approvals/:approvalId/approve
- POST /api/approvals/:approvalId/reject
- POST /api/sentinel/incident

## Troubleshooting Runbook

## Symptom: OAuth token errors (400 or 401)

Checks:

1. Verify TENANT_ID, CLIENT_ID, CLIENT_SECRET values.
2. Confirm client secret is not expired.
3. Confirm API permissions are granted and admin consented.
4. Confirm token scope values in .env are correct.

## Symptom: 403 from Defender or Graph APIs

Checks:

1. Verify app has required API permissions.
2. Validate customer licensing supports requested Defender APIs.
3. Confirm endpoint path is valid for the tenant and service plan.

## Symptom: No data in Power BI visuals

Checks:

1. Call GET /api/health and verify hasSnapshot is true.
2. Call GET /api/powerbi/full-snapshot and inspect payload.
3. Confirm Power BI query points to the right host and port.
4. Trigger POST /api/admin/refresh and retry Power BI refresh.

## Symptom: Missing remediation recommendations from MCP sources

Checks:

1. Verify MCP_BRIDGE_URL is reachable from the host.
2. Verify MCP_BRIDGE_API_KEY is valid.
3. Verify MCP bridge supports expected servers/capabilities.
4. If unreachable, fallback recommendations are generated by design.

## Symptom: Scheduler not running

Checks:

1. Validate REFRESH_CRON expression format.
2. Review startup logs for cron validation errors.
3. Verify service process stays alive in production host.

## Symptom: Approval requests are not reaching reviewers

Checks:

1. Verify TEAMS_APPROVAL_WEBHOOK_URL is set and reachable.
2. Validate APPROVAL_TTL_MINUTES is long enough for approver workflow.
3. Check GET /api/approvals/pending for pending requests.
4. Confirm caller sends x-user-role and x-user-id headers for approval actions.

## Symptom: Windows service fails to start

Checks:

1. Verify Node.js is installed and available in PATH for LocalSystem context.
2. Verify .env contains valid TENANT_ID, CLIENT_ID, CLIENT_SECRET.
3. Review WinSW logs under install_path\\logs.
4. Re-run installer with -ForceReinstall to refresh binaries and wrapper config.

## Symptom: Enterprise app registration script errors

Checks:

1. Ensure Microsoft Graph PowerShell modules can be installed from PSGallery.
2. Ensure signed-in account has privileges to create apps and grant app role assignments.
3. If consent assignment is blocked by policy, run script with -SkipAdminConsent and perform consent separately.

## Operational Best Practices

- Store secrets in a secure vault and inject at runtime.
- Rotate client secrets regularly.
- Use a dedicated Entra app per customer tenant.
- Run refresh in intervals aligned with API rate limits.
- Alert on API health endpoint failures.
- Back up or export data/ snapshots if historical analysis is required.

## Support Checklist

When opening a support case, include:

1. Timestamp of the issue (UTC)
2. Endpoint called
3. HTTP status code and error message
4. Sanitized logs around the failure window
5. Current .env keys list (without secret values)
6. Output from:

```powershell
Invoke-RestMethod http://localhost:4010/api/health
Invoke-RestMethod http://localhost:4010/api/powerbi/overview
```

## PowerShell Script Inventory

- scripts/Deploy-HealthHubClient.ps1: One-command orchestration for enterprise app registration + service install
- scripts/Register-HealthHubEnterpriseApp.ps1: Creates/updates app registration, service principal, permissions, consent, and emits .env values
- scripts/Install-HealthHubWindowsService.ps1: Builds app, installs WinSW wrapper, configures restart policy, starts service
- scripts/Uninstall-HealthHubWindowsService.ps1: Removes service and optionally deletes install directory

## Create and Publish This as a New Git Repository

This folder is initialized as an independent git repository.

To publish to GitHub:

```powershell
git add .
git commit -m "Initial commit: Agentic Exposure and Secure Score Management Tool"
git remote add origin <your-new-repo-url>
git push -u origin main
```

## Notes

- The pipeline is designed to survive partial source failures and still produce a snapshot.
- Error logs are sanitized to avoid leaking secrets.
- This repository is separate from BP-API-integration and intended to be published as a standalone customer-deliverable application.
