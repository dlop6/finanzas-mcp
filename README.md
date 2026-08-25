# Finance MCP

**Author:** Diego López #23747

Finance MCP is a local Model Context Protocol server for small-business financial management. It implements MCP `2025-11-25` and JSON-RPC manually, without an MCP SDK.

The server runs as a separate Node.js process, communicates through STDIO, and stores its state in PostgreSQL through Prisma. It provides 24 tools for transactions, debts, receivables, inventory, cash flow, projections, and purchase viability. All financial calculations are performed by Finance MCP.

The Host can also start the official Filesystem MCP as a separate local process. Its access is restricted to `docs/generated`; it cannot access the rest of the repository. Filesystem reads run directly, while file creation, edits, directory creation, and moves require explicit Host confirmation.

The Host can also start the official Git MCP in the isolated `docs/generated/git-demo` repository. Git reads run directly; staging, commits, resets, branch creation, and checkout require explicit Host confirmation. Git MCP cannot access the main project repository, and remote Git operations are not included.

## Requirements

- Node.js 22.12 or later
- npm
- Docker Desktop
- Python 3.10 or later and Git (for the optional local Git MCP)

## Installation

From the project root, install the dependencies and create the local environment file:

```powershell
npm ci
Copy-Item .env.example .env
npm run git:mcp:setup
```

Start PostgreSQL and prepare the database:

```powershell
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
```

PostgreSQL runs locally on port `5434`. The seed creates the deterministic `Tienda Demo` dataset. Running the seed again replaces the local financial data.

## Git MCP

Prepare and verify the isolated Git MCP runtime with:

```powershell
npm run git:mcp:setup
npm run test:git:integration
```

It can operate only in `docs/generated/git-demo`. Reads run directly; staging, commits, resets, branch creation, and checkout require explicit Host confirmation. It cannot access this project repository or use remotes.

## End-to-end demo

With PostgreSQL running and the Git MCP prepared, start the local interactive demo:

```powershell
npm run db:up
npm run git:mcp:setup
npm run demo:e2e
```

It obtains a complete financial report through Finance MCP, saves it in `docs/generated/git-demo` through Filesystem MCP, and stages and commits it through Git MCP. Writing, staging, and committing each require a separate confirmation. The demo never pushes to a remote. Its isolated automated check is available with `npm run test:e2e:local`.

## Usage

Start the local Finance MCP server:

```powershell
node --import tsx servers/finance-mcp/stdio.ts
```

The process waits for one compact JSON-RPC message per line. Send these messages in order.

Initialize the MCP lifecycle:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-client","version":"1.0.0"}}}
```

Notify the server that initialization finished:

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

Discover the 24 available tools:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Call a read-only tool:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_current_balance","arguments":{}}}
```

Each response preserves the request ID. Notifications have no ID and produce no response. Avoid empty input lines because each line is parsed as a JSON-RPC message.

To run an automated check of the local MCP and its tools:

```powershell
npm run db:finance-tools:smoke
```

Stop Finance MCP with `Ctrl+C`. Stop PostgreSQL while preserving its local volume with:

```powershell
npm run db:down
```

## Remote database initialization

To initialize a new Render PostgreSQL database from this computer, store its External Database URL only as `DATABASE_URL_REMOTE` in your local `.env`, then run:

```powershell
npm run db:remote:setup
```

The command requires an explicit confirmation, applies the existing migrations, loads the canonical dataset, and verifies it. It only accepts an empty external TLS Render database; it is not a reset command. UN-40 will use Render's Internal Database URL as `DATABASE_URL` for the deployed MCP.

## Streamable HTTP transport

Finance MCP also exposes the same 24 tools through local Streamable HTTP MCP `2025-11-25`:

```powershell
npm run finance:mcp:http
```

It listens on `http://127.0.0.1:3001/mcp` by default. Send JSON-RPC requests with `POST`, `Content-Type: application/json`, and an `Accept` header that accepts both `application/json` and `text/event-stream`. Initialize first to receive `MCP-Session-Id`; subsequent requests must include that header and `MCP-Protocol-Version: 2025-11-25`.

`GET /mcp` returns `405` because this server does not initiate messages and does not use SSE. This local transport has no authentication, remote deployment, or Host HTTP client yet.
