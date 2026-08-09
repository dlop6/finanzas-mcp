# ADR-002 — Implement MCP and JSON-RPC manually

**Status:** Accepted

## Context
The academic goal requires understanding and implementing the protocol exchange rather than hiding it behind an SDK.

## Decision
Implement manually:
- JSON-RPC request/response/notification/error structures;
- IDs;
- parsing and validation;
- MCP lifecycle;
- `initialize`;
- `tools/list`;
- `tools/call`;
- protocol errors;
- local and remote transport integration.

Do not use FastMCP or another library that implements MCP on behalf of the project.

## Consequences
**Positive:** explicit protocol behavior, better logs, easier academic explanation.  
**Negative:** more protocol code and higher specification-mismatch risk.

## Guardrail
Protocol behavior must be verified against MCP specification 2025-11-25 before being considered final.
