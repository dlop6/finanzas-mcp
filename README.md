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

## MCP tools

After the MCP lifecycle handshake, the Host uses `tools/list` to discover the Finance MCP tools and `tools/call` to invoke one by name. Tool definitions expose only `name`, `description`, and an `inputSchema` written in JSON Schema 2020-12. The Finance MCP validates arguments with Ajv before calling a handler.

Malformed protocol requests and unknown tools return JSON-RPC errors. Arguments that do not satisfy a valid tool schema return a successful MCP tool result with `isError: true`, so a future LLM can read and correct them. Internal metadata such as `isWriteOperation` is not exposed by `tools/list`.

The production registry provides transaction, debt, receivable, inventory, balance, cash-flow-summary, and 7/30-day projection tools. Projections use the UTC date of the service, include only future dates through the selected horizon, and distinguish confirmed receivables from unconfirmed potential cash. Inventory includes product creation and listing, product metadata updates, stock movements, and low-stock discovery. Initial stock does not create a synthetic movement; only inventory movement tools adjust stock. Current balance is derived from initial account balances plus real income minus real expenses; debts and receivables do not change it. All monetary input is a decimal string and output is normalized to two decimal places. Write confirmation remains a Host responsibility and is not performed by Finance MCP.

## Financial persistence

Finance MCP accesses PostgreSQL through five cohesive repositories: business and catalog data, transactions, debts, receivables, and inventory. The repository factory receives the single Prisma Client exported by `database/client.ts`; repositories never create database clients themselves.

The MVP requires exactly one active business. A missing or ambiguous business configuration fails with a controlled error instead of selecting an arbitrary record. Every repository query and mutation is restricted to that business.

Repository results keep Prisma `Decimal` values and `Date` objects internally, so financial values are never converted to floating-point numbers. Missing records, uniqueness conflicts, and unexpected persistence failures are exposed as controlled repository errors without Prisma messages, SQL, credentials, or connection URLs.

Inventory movements update the product stock and create or delete the movement in one database transaction. Deleting a movement reverses its stock effect; any operation that would make stock negative is rejected without partial changes.

The persistence layer does not implement MCP financial tools, financial calculations, LLM behavior, or write confirmations. Those responsibilities are added in subsequent tickets.

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
npm run db:repositories:smoke
npm run db:finance-tools:smoke
npm run db:reset
npm run db:down
```

`db:reset` deletes local database data, recreates migrations, and runs the configured local seed. `db:down` stops the container and preserves the project volume. The seed is destructive to the local project database: it truncates the financial tables, resets identities, and loads the deterministic demo dataset. Never run it against production.

`db:repositories:smoke` is a read-only local check that uses the Finance MCP repositories against the deterministic seed. It requires the local database to be running and seeded.

`db:finance-tools:smoke` starts the real Finance MCP through STDIO, completes the MCP lifecycle, exercises the transaction tools, and removes its temporary records through the same tools. It requires the local database to be running and seeded.

## Financial schema and deterministic demo data

The schema contains exactly `Business`, `Account`, `Category`, `Transaction`, `FixedExpense`, `Debt`, `Receivable`, `Product`, and `InventoryMovement`, plus the required domain enums. Monetary fields use PostgreSQL `Decimal(14,2)`; financial dates use `DATE`; timestamps use `TIMESTAMPTZ(3)`. There is no mutable balance column: the balance is derived as initial account balances plus income transactions minus expense transactions.

The seed uses the canonical date `2026-08-08` and creates the single business `Tienda Demo`, its accounts and categories, 20 transactions, fixed expenses, pending debts, confirmed and unconfirmed receivables, five products, and ten inventory movements. `db:verify` checks counts, ownership, precision, date window, derived balance `Q19,475.00`, low-stock products, and movement/stock consistency. Running `db:seed` again recreates the same logical dataset.
