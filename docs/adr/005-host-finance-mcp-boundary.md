# ADR-005 — Enforce Host ↔ Finance MCP boundary through MCP only

**Status:** Accepted

## Context
Host and Finance MCP live in the same repository, making direct imports easy but architecturally incorrect for this project.

## Decision
Host may not call Finance MCP services, repositories or handlers directly. All communication goes through MCP/JSON-RPC.

## Consequences
**Positive:** local/remote modes preserve the same contract and protocol remains demonstrable.  
**Negative:** even local operations require serialization.

## Guardrail
A direct import from `host/` into Finance MCP business internals is an architecture violation.
