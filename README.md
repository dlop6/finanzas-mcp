# Finance MCP

University networking project: a Next.js chatbot Host that communicates with a custom Finance MCP through manual MCP/JSON-RPC.

## Architecture

```text
Next.js UI → Host → MCP/JSON-RPC over STDIO → Finance MCP → PostgreSQL
```

The Host never imports Finance MCP tools, services, or repositories. Finance MCP owns financial rules and database access; the future LLM only interprets results.

## Current Finance MCP capabilities

- Transactions, debts, receivables, and basic inventory.
- Current balance, cash-flow summary, 7/30-day projections, and purchase viability.
- Deterministic demo data for one GTQ business.

After lifecycle initialization, clients use `tools/list` and `tools/call`. Tool inputs are validated with JSON Schema; invalid tool arguments return `isError: true`. Financial amounts use decimal strings and are returned with two decimal places.

## Requirements

- Node.js 24.14 or compatible
- npm
- Docker Desktop

## Local setup

```bash
npm ci
copy .env.example .env
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
```

The local PostgreSQL container uses port `5434`. `.env` is local-only; never commit secrets.

## Run and verify

```bash
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run db:finance-tools:smoke
```

Open the web app at <http://localhost:3000>. The Finance smoke check starts the real server over STDIO and exercises the MCP tools.

## Database commands

| Command | Purpose |
| --- | --- |
| `npm run db:check` | Check the local database connection. |
| `npm run db:migrate:status` | Show migration status. |
| `npm run db:repositories:smoke` | Run read-only repository checks. |
| `npm run db:down` | Stop PostgreSQL and preserve its volume. |
| `npm run db:reset` | Recreate local data and run the seed. **Destructive.** |

The seed creates `Tienda Demo`, 20 transactions, fixed expenses, pending debts and receivables, five products, and inventory movements. The current balance is derived from initial balances plus income minus expenses; it is never stored as a mutable field.

For the full technical specification, architecture decisions, and protocol details, see [`docs/`](docs/).
