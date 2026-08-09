# Finanza MCP

University networking project: a Next.js web chatbot acting as an MCP Host and connecting to a custom Finance MCP through manual MCP/JSON-RPC messages.

## Repository boundaries

This is one repository with explicit module boundaries. The folders are not independent packages or workspaces.

```text
app/                         Next.js App Router UI
host/                        MCP Host responsibilities
  llm/                       LLM integration boundary
  context/                   Conversation context boundary
  orchestration/             Request orchestration boundary
  confirmation/              User confirmation boundary for writes
  mcp-clients/               MCP/JSON-RPC client boundary
servers/finance-mcp/         Finance MCP server boundary
  tools/                     MCP tool handlers
  services/                  Financial rules and calculations
  repositories/              Persistence access
shared/                      Small cross-boundary contracts
  jsonrpc/                   JSON-RPC messages
  mcp/                       MCP protocol messages
  types/                     Shared TypeScript types
database/                    Schema, migrations, and seed data
tests/                       Unit and integration tests
docs/                        Architecture, capture, and evidence material
```

The Host and Finance MCP communicate exclusively through MCP/JSON-RPC messages. Host code must not import Finance MCP tools, services, or repositories directly. These boundaries remain within the single repository to keep the project simple and easy to test.

## Requirements

- Node.js 24.14 or compatible
- npm

PostgreSQL and service-specific environment variables will be added in later tickets. Do not commit real `.env` files or secrets.

## Install

```bash
npm ci
```

## Development

```bash
npm run dev
```

Open <http://localhost:3000>.

## Quality checks

```bash
npm test
npm run test:watch
npm run typecheck
npm run lint
npm run build
```

`npm test` runs Vitest once in a non-interactive mode. The smoke test renders the existing synchronous Next.js Home component with React Testing Library, and the architecture test protects the Host boundary.
