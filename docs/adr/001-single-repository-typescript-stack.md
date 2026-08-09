# ADR-001 — Use a single TypeScript repository

**Status:** Accepted

## Context
The project contains a Next.js UI, an MCP Host, a custom Finance MCP, shared protocol types, database code and tests. It is an individual, time-bounded project.

## Decision
Use one repository with TypeScript across UI, Host and Finance MCP. Do not introduce Nx, Turborepo or another monorepo framework.

## Consequences
**Positive:** one language, simpler setup, less tooling overhead.  
**Negative:** boundaries must be enforced by structure and discipline.

## Guardrail
Shared repository does not mean shared runtime internals. Host and Finance MCP communicate only through MCP/JSON-RPC.
