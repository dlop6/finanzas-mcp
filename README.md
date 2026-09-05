# Finance MCP

**Author:** Diego López #23747

Finance MCP is a TypeScript project for small-business financial management through the Model Context Protocol (MCP). It includes a Next.js Web workspace, a conversational Host, a custom Finance MCP server, and official local Filesystem and Git MCP servers.

The Finance server implements JSON-RPC and MCP `2025-11-25` manually; no MCP SDK implements the protocol for this project. Finance MCP is the authority for balances, cash flow, projections, purchase viability, inventory, and all other financial calculations.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Install and prepare a local environment](#install-and-prepare-a-local-environment)
- [Configuration](#configuration)
- [Run the Web workspace and Host](#run-the-web-workspace-and-host)
- [Run Finance MCP directly](#run-finance-mcp-directly)
- [Filesystem MCP and Git MCP](#filesystem-mcp-and-git-mcp)
- [Finance MCP local and remote modes](#finance-mcp-local-and-remote-modes)
- [Testing and verification](#testing-and-verification)
- [Safety and current limits](#safety-and-current-limits)

## Features

- A read-only financial dashboard with current balance, monthly income and expenses, 7/30-day projections, receivables, debts, and low-stock products.
- A Spanish Web chat backed by DeepSeek and the Host. Conversation state lasts only for the current browser tab.
- A Finance MCP catalog of 26 tools: 10 reads and 16 writes for transactions, debts, receivables, inventory, cash flow, projections, and purchase viability.
- Official Filesystem MCP restricted to `docs/generated` and official Git MCP restricted to the nested `docs/generated/git-demo` repository.
- Explicit Host confirmation for all 25 global write tools. The browser only sends a confirmation decision; it never sends tool arguments back to the Host.
- A Web `Logs MCP` tab for sanitized in-memory lifecycle, dashboard, and current-chat interactions.
- Finance MCP through local STDIO or remote Streamable HTTP, with the same 26-tool public contract.
- Income and expense requests use real account and category names. The Host retrieves and verifies their internal references before it presents the normal write confirmation.
- Multiple homogeneous income or expense records can be prepared as one batch of 2 to 25 rows. The confirmation shows every row by verified names, and Finance MCP persists the complete batch atomically or persists none of it.
- A local Finance → Filesystem → Git end-to-end demo that writes, stages, and commits one generated report after three independent confirmations.

## Architecture

```text
Browser
  -> Next.js Web workspace
  -> Host (sessions, orchestration, confirmations, MCP logs)
  -> DeepSeek for interpretation and explanation
  -> Finance MCP / official Filesystem MCP / official Git MCP

Finance MCP -> Prisma -> PostgreSQL
```

The UI never accesses DeepSeek, MCP transports, Prisma, or PostgreSQL directly. The Host routes discovered tools to their owning MCP client and does not import Finance services or repositories. Finance MCP owns financial persistence and calculations; an LLM can request tools and explain their structured results, but cannot replace financial calculations.

Finance, Filesystem, and Git each run as independent MCP processes. The local and remote Finance deployments use the same lifecycle and tool contract, but their databases are independent and are not synchronized.

For detailed boundaries and protocol decisions, see [the architecture documentation](docs/architecture/architecture.md), [the Finance tool specification](docs/finance-mcp-tools.md), and the ADRs under `docs/adr/`.

## Requirements

- Node.js 22.12 or later
- npm
- Docker Desktop for local PostgreSQL and isolated integration tests
- Python 3.10 or later and Git for the local Git MCP
- A DeepSeek API key only when using the real Web chat or the DeepSeek smoke check

## Install and prepare a local environment

From the repository root:

```powershell
npm ci
Copy-Item .env.example .env
npm run git:mcp:setup
```

`git:mcp:setup` creates an isolated `.venv-git-mcp` environment and prepares the nested `docs/generated/git-demo` repository. Both paths are ignored by the main repository. The command is idempotent and does not modify global Python.

Start and prepare local PostgreSQL:

```powershell
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
```

The local database listens on port `5434`. The deterministic `Tienda Demo` seed is loaded by `db:seed`; running that local seed again replaces the local financial dataset. Stop the local container while retaining its volume with:

```powershell
npm run db:down
```

## Configuration

Copy `.env.example` to `.env` and keep `.env` local. Do not commit keys, database URLs, headers, or session identifiers.

| Variable | Purpose | Local default or requirement |
| --- | --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local Docker PostgreSQL configuration | Values from `.env.example`; port `5434` |
| `DATABASE_URL` | Local Finance MCP PostgreSQL connection | Required for local Finance MCP |
| `DEEPSEEK_API_KEY` | DeepSeek credential | Required for the real Web chat |
| `DEEPSEEK_BASE_URL` | HTTPS DeepSeek API endpoint | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | DeepSeek model name | `deepseek-v4-flash` |
| `CONTEXT_COMPACTION_THRESHOLD` | Host context-compaction threshold | `6000` |
| `FINANCE_MCP_MODE` | Finance transport selected by the Host | `local` or `remote`; defaults to `local` |
| `FINANCE_MCP_REMOTE_URL` | Remote Finance MCP Streamable HTTP endpoint | Required only in `remote` mode; HTTPS `/mcp` URL |
| `MCP_HTTP_HOST`, `PORT`, `MCP_ALLOWED_ORIGINS` | Finance MCP HTTP server configuration | Used when running `finance:mcp:http` |
| `DATABASE_URL_REMOTE` | External Render PostgreSQL URL for one-time remote initialization | Used only by `db:remote:setup`; never expose it |

`TEST_*` variables in `.env.example` are for isolated test infrastructure. They are not production credentials.

### Local PostgreSQL and remote PostgreSQL

Use `DATABASE_URL` for the local database. A Render service uses its **Internal Database URL** as `DATABASE_URL`; an external Render URL is only for the guarded local initialization command:

```powershell
npm run db:remote:setup
```

The command asks for an exact confirmation, applies existing migrations with `prisma migrate deploy`, loads the canonical seed only into an empty remote database, and verifies it. It is not a reset command and never accepts a force option.

## Run the Web workspace and Host

With local PostgreSQL, Git MCP setup, and DeepSeek configuration ready, run:

```powershell
npm run dev
```

Open the local URL printed by Next.js. The workspace starts on **Resumen financiero** and includes:

- **Resumen financiero:** dashboard data from Finance MCP. It starts Finance MCP only, so it does not require DeepSeek, Filesystem MCP, or Git MCP.
- **Chat:** Spanish conversation through the Host and DeepSeek. It extends the shared Finance runtime with the local Filesystem and Git MCP clients, yielding 52 registered tools in total.
- **Logs MCP:** sanitized in-memory lifecycle, dashboard, and current-tab chat interactions. Logs disappear when the Host process restarts.

The Host initializes runtime components lazily. A dashboard request does not start DeepSeek. Opening Chat requires the DeepSeek configuration and the local Filesystem/Git prerequisites.

The Host is embedded in the Next.js server for the Web workspace; there is no separate long-running Host command. To exercise Host orchestration from the terminal after configuring DeepSeek and local PostgreSQL, run:

```powershell
npm run orchestration:smoke
```

### Basic Web flow

1. Open **Resumen financiero** and select **Actualizar** to fetch current read-only data.
2. Open **Chat** and ask a general or financial question in Spanish.
3. For a financial read, the Host lets DeepSeek request the appropriate Finance MCP tool and returns the resulting explanation.
4. For a write, inspect the inline confirmation card and its exact arguments. Select **Confirmar operación** to execute the Host-stored operation, or **Cancelar** to discard it.
5. Open **Logs MCP** to inspect the sanitized request and response metadata for the current process.

The browser does not send write arguments on confirmation, cannot edit a pending operation, and has no automatic retries or undo.

## Run Finance MCP directly

Start Finance MCP through STDIO:

```powershell
node --import tsx servers/finance-mcp/stdio.ts
```

The server accepts one compact JSON-RPC message per line. Complete the lifecycle in order:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-client","version":"1.0.0"}}}
```

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_current_balance","arguments":{}}}
```

Each response preserves its request ID. `notifications/initialized` has no ID and produces no response. Stop the process with `Ctrl+C`.

For a local HTTP server instead of STDIO:

```powershell
npm run finance:mcp:http
```

It listens at `POST http://127.0.0.1:3001/mcp` by default. Requests require `Content-Type: application/json` and an `Accept` header compatible with `application/json` and `text/event-stream`. After `initialize`, send `MCP-Session-Id` and `MCP-Protocol-Version: 2025-11-25` on subsequent requests. `GET /mcp` returns `405`; this implementation does not use SSE or server-initiated messages.

Useful local checks:

```powershell
npm run db:finance-tools:smoke
npm run finance:mcp:client:smoke
```

## Filesystem MCP and Git MCP

The official Filesystem MCP is local-only and restricted to `docs/generated`. It cannot access the rest of the project. Reads execute immediately; file creation, edits, directory creation, and moves require Host confirmation.

The official Git MCP is local-only and restricted to the nested repository at `docs/generated/git-demo`. It cannot access the main project repository or remote Git operations. Reads execute immediately; staging, commits, resets, branch creation, and checkout require Host confirmation.

Verify the Git integration:

```powershell
npm run git:mcp:setup
npm run test:git:integration
```

Run the interactive Finance → Filesystem → Git demo:

```powershell
npm run db:up
npm run git:mcp:setup
npm run demo:e2e
```

The demo generates a Markdown report, writes it inside the isolated repository, stages it, and commits it. Writing, staging, and committing require separate confirmations. It never pushes to a remote.

## Finance MCP local and remote modes

The Host reads these settings when it starts:

```dotenv
FINANCE_MCP_MODE=local
FINANCE_MCP_REMOTE_URL=https://finanzas-mcp-server.onrender.com/mcp
```

| Mode | Finance transport | Database | Other MCP servers |
| --- | --- | --- | --- |
| `local` | A local Finance MCP child process over STDIO | Local PostgreSQL | Filesystem and Git remain local |
| `remote` | Streamable HTTP MCP at `FINANCE_MCP_REMOTE_URL` | Database behind the remote Finance deployment | Filesystem and Git remain local |

`local` is the default. Remote mode requires a valid HTTPS URL with the exact `/mcp` path and does not fall back to local mode if the remote endpoint fails. Restart the Host after changing either setting.

Validate the selected Finance mode with one read-only request:

```powershell
npm run finance:mcp:client:smoke
```

The current public Finance MCP endpoint is [https://finanzas-mcp-server.onrender.com/mcp](https://finanzas-mcp-server.onrender.com/mcp). It is a Render Web Service built with:

```text
npm ci --include=dev; npm run db:generate
```

and started with:

```text
npm run finance:mcp:http
```

Render supplies `PORT`; the deployed service uses `MCP_HTTP_HOST=0.0.0.0` and its internal PostgreSQL URL as `DATABASE_URL`.

## Testing and verification

Run the common local checks:

```powershell
npm test
npm run test:finance:integration
npm run test:finance:http:integration
npm run test:git:integration
npm run test:e2e:local
npm run typecheck
npm run lint
npm run build
```

The final local regression runs the required MCP, confirmation, end-to-end, type, lint, and production-build checks in one command:

```powershell
npm run test:e2e:regression
```

This command does not contact Render or use DeepSeek. The full verification matrix and safe-evidence rules are in [docs/evidence/un-52-e2e-regression.md](docs/evidence/un-52-e2e-regression.md).

With remote Finance mode configured, run the separate remote validation:

```powershell
npm run test:finance:remote
```

It validates the remote 24-tool contract, reads, projections, purchase viability, and controlled errors. It then asks for separate confirmations to create and delete a temporary GTQ 1.00 income. It uses Streamable HTTP only, never connects directly to remote PostgreSQL, and must finish with 20 transactions and a `19475.00` current balance.

## Safety and current limits

- Do not commit `.env`, credentials, database URLs, TLS key logs, or network captures.
- Finance writes, Filesystem writes, and Git writes require Host confirmation. Read-only tools do not.
- Git remote operations, push, pull, pull requests, merge, rebase, and remote synchronization are out of scope.
- The Web workspace has no authentication, browser persistence, streaming, polling, exports, or direct database access. Do not expose its logs view as a public administration console.
- The remote Finance endpoint has no authentication in this MVP. Do not treat it as a production-grade public API.
- The project has no automatic retry, transport fallback, or remote database reset facility.

## Additional documentation

- [Architecture](docs/architecture/architecture.md)
- [Finance MCP public tool specification](docs/finance-mcp-tools.md)
- [Architecture decisions](docs/adr/)
- [Wireshark capture guides and reports](docs/wireshark/README.md)
- [Design QA](docs/design-qa/)
- [Final regression evidence](docs/evidence/un-52-e2e-regression.md)

## Final academic report

Generate the final academic report in PDF with:

```powershell
npm run report:pdf
```

The editable source is `docs/final-report.md`. The generated PDF is `output/pdf/finance-mcp-final-report.pdf`.
