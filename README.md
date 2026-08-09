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
npm run db:verify
npm run db:reset
npm run db:down
```

`db:reset` deletes local database data, recreates migrations, and runs the configured local seed. `db:down` stops the container and preserves the project volume. The seed is destructive to the local project database: it truncates the financial tables, resets identities, and loads the deterministic demo dataset. Never run it against production.

## Financial schema and deterministic demo data

The schema contains exactly `Business`, `Account`, `Category`, `Transaction`, `FixedExpense`, `Debt`, `Receivable`, `Product`, and `InventoryMovement`, plus the required domain enums. Monetary fields use PostgreSQL `Decimal(14,2)`; financial dates use `DATE`; timestamps use `TIMESTAMPTZ(3)`. There is no mutable balance column: the balance is derived as initial account balances plus income transactions minus expense transactions.

The seed uses the canonical date `2026-08-08` and creates the single business `Tienda Demo`, its accounts and categories, 20 transactions, fixed expenses, pending debts, confirmed and unconfirmed receivables, five products, and ten inventory movements. `db:verify` checks counts, ownership, precision, date window, derived balance `Q19,475.00`, low-stock products, and movement/stock consistency. Running `db:seed` again recreates the same logical dataset.
