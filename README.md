# Finance MCP

**Author:** Diego López #23747

Finance MCP is a local Model Context Protocol server for small-business financial management. It implements MCP `2025-11-25` and JSON-RPC manually, without an MCP SDK.

The server runs as a separate Node.js process, communicates through STDIO, and stores its state in PostgreSQL through Prisma. It provides 24 tools for transactions, debts, receivables, inventory, cash flow, projections, and purchase viability. All financial calculations are performed by Finance MCP.

The Host can also start the official Filesystem MCP as a separate local process. Its access is restricted to `docs/generated`; it cannot access the rest of the repository. Filesystem reads run directly, while file creation, edits, directory creation, and moves require explicit Host confirmation.

## Requirements

- Node.js 22.12 or later
- npm
- Docker Desktop

## Installation

From the project root, install the dependencies and create the local environment file:

```powershell
npm ci
Copy-Item .env.example .env
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
