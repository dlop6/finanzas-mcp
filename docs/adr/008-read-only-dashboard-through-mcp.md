# ADR-008 — Make the dashboard read-only and backed by Finance MCP

**Status:** Accepted

## Context
A web UI is part of scope, but duplicating full CRUD outside the chat would add work and create competing application paths.

## Decision
The dashboard is read-only. It obtains financial data through Finance MCP via the Host and never accesses Prisma/PostgreSQL directly. Mutations remain tool-driven with explicit confirmation.

## Consequences
**Positive:** avoids duplicate CRUD, keeps MCP central, reduces scope.  
**Negative:** some actions that could be buttons must be done through chat.

## Guardrail
Do not add dashboard CRUD unless this specification is formally changed.
