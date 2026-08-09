# ADR-006 — Use the same Finance MCP implementation locally and remotely

**Status:** Accepted

## Context
The project requires a local custom MCP and the same MCP deployed remotely.

## Decision
Maintain one Finance MCP business/tool implementation. Local and remote modes may differ only in transport, environment configuration, database connection and deployment concerns.

## Consequences
**Positive:** DRY, consistent behavior, simpler testing and demo.  
**Negative:** transport boundaries must remain clean.

## Guardrail
Behavior differences between local and remote modes are bugs unless explicitly documented.
