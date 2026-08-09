# ADR-003 — Use PostgreSQL + Prisma as Finance MCP persistence

**Status:** Accepted

## Context
Finance MCP needs persistent state for transactions, debts, receivables, fixed expenses and inventory.

## Decision
Use PostgreSQL with Prisma. Finance MCP owns database access. Host and UI do not access PostgreSQL directly. Local and remote deployments use independent databases.

## Consequences
**Positive:** relational model fits the domain, migrations/seed are explicit, integration testing is straightforward.  
**Negative:** local and remote demo data can diverge.

## Guardrail
Do not build synchronization between local and remote databases.
