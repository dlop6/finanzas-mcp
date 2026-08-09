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
- Docker Desktop

## Install

```bash
npm ci
copy .env.example .env
```

The `.env` file is local-only and ignored by Git. Never commit real secrets.

## Application development

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

## Local PostgreSQL and Prisma

The project uses one PostgreSQL 17 Alpine container on host port `5434`. Existing PostgreSQL containers on ports `5432` and `5433` belong to another project and are not modified.

```bash
npm run db:up
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:migrate:status
npm run db:check
npm run db:seed
npm run db:reset
npm run db:down
```

`db:reset` deletes local database data before recreating migrations. `db:down` stops the container and preserves the project volume. UN-5 only provides the technical seed hook; financial entities are added in UN-6.
