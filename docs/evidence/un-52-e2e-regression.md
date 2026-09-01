# UN-52 — Final end-to-end regression

This checklist records the reproducible final regression for the Finance MCP project. It deliberately keeps credentials, URLs configured locally, session identifiers, request headers, raw JSON-RPC payloads, and complete write arguments out of version control.

## Automated local regression

Run from the repository root:

```powershell
npm run test:e2e:regression
```

The command prepares the isolated Git MCP environment and runs the general, Finance STDIO, Finance HTTP, Git, and Finance → Filesystem → Git regression suites, followed by typecheck, lint, and the production build. It does not contact Render, use DeepSeek, or persist generated evidence.

### Execution record

| Date (UTC-06:00) | Command | Observed result |
| --- | --- | --- |
| 2026-08-29 | `npm run test:e2e:regression` | PASS — Git MCP setup; general/STDIO; Finance STDIO; Finance HTTP; Git; local demo; three typechecks; lint; and production build all completed. |
| 2026-08-31 | `FINANCE_MCP_MODE=remote npm run finance:mcp:client:smoke` | PASS — the public Streamable HTTP client completed a read-only lifecycle, discovery of 24 tools and clean closure. |

| ID | Area | Mode | Scenario | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| A1 | Finance MCP | Local STDIO | Lifecycle and discovery | `initialize`, `tools/list`, and 24 tools succeed | PASS when automated suite passes |
| A2 | Finance MCP | Local/HTTP | Reads, projections, viability, inventory, errors | Canonical contracts and safe failures hold | PASS when automated suites pass |
| A3 | Confirmations | Local | Finance, Filesystem, and Git writes | No mutation before confirmation; cancellation has no effect | PASS when automated suites pass |
| A4 | Filesystem MCP | Local | Restricted read/write flow | Official MCP stays inside its allowed sandbox | PASS when automated suite passes |
| A5 | Git MCP | Local | Staging and commit flow | Official MCP changes only its isolated repository | PASS when automated suite passes |
| A6 | Full demo | Local | Finance → Filesystem → Git | Three independently confirmed operations complete | PASS when automated suite passes |
| A7 | Quality gates | Local | Types, lint, production build | All complete successfully | PASS when automated suite passes |

## Manual Web validation

Use the configured Finance mode without inspecting configuration values. In local mode, verify dashboard loading, chat context, a financial read, a pending write confirmation, cancellation, confirmed execution and MCP logs. Repeat the read-only dashboard, chat and log checks in remote Finance mode. Capture only safe UI states; do not capture developer tools, terminal output, session identifiers, headers, raw payloads or write arguments.

| ID | Area | Mode | Scenario | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| M1 | Dashboard | Local | Initial load and manual refresh | Finance data renders and refresh preserves visible data | PASS |
| M2 | Chat | Local | General message and follow-up | Same tab retains context without duplicate messages | Manual |
| M3 | Web confirmation | Local | Cancel then confirm one controlled financial write | Host retains the operation; the browser sends only the decision | Manual |
| M4 | Logs MCP | Local | Dashboard and chat activity | Sanitized lifecycle, request and response entries are visible | PASS |
| M5 | Finance transport | Remote | Read-only dashboard and chat request | `STREAMABLE_HTTP` succeeds with no local fallback | Manual |

### Local Web observation

| Date (UTC-06:00) | Mode | Observed result |
| --- | --- | --- |
| 2026-08-29 | Local STDIO with ephemeral PostgreSQL | PASS — the dashboard rendered canonical balances, projections, pending items and stock; the Logs MCP tab displayed sanitized lifecycle, discovery and dashboard request/response entries. |

## Remote reversible validation

With remote Finance mode configured, run:

```powershell
npm run test:finance:remote
```

It requires two separate human confirmations: one to create a controlled `GTQ 1.00` income and one to delete it. The run is successful only if it ends with 20 transactions and current balance `19475.00`. It uses Streamable HTTP MCP only; it does not open a direct PostgreSQL connection.

| ID | Area | Mode | Scenario | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Finance MCP | Remote | Lifecycle and 24-tool contract | Remote contract matches the productive Finance catalog | PASS |
| R2 | Finance MCP | Remote | Reads, projections, viability and safe errors | Results are valid and the session remains usable | PASS |
| R3 | Finance MCP | Remote | Confirmed reversible income | Persistence is visible through MCP, then fully restored | PASS — final state verified as 20 transactions and current balance `19475.00`. |

## Evidence policy

Safe screenshots, when collected for the final report, belong under `docs/evidence/un-52/` and must show only ordinary UI content. Associate each committed screenshot with a SHA-256 in this document. Never commit local environment files, captures of terminal output, session IDs, headers, raw tool payloads, or artifacts containing secrets.

## Final result

The observed local dashboard/log panel and remote reversible checks passed. A failed cleanup, failed automatic suite, or blocking Web defect prevents UN-52 from being marked complete.
