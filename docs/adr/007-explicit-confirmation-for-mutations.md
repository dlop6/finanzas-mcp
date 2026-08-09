# ADR-007 — Require Host confirmation for every mutation

**Status:** Accepted

## Context
The LLM may infer a write action from natural language. Executing it immediately could modify business state without explicit approval.

## Decision
Every write tool requires explicit confirmation in the Host before `tools/call`. Host stores the exact pending operation and arguments. Confirmation executes exactly that operation. Cancellation discards it. Read tools do not require confirmation.

## Consequences
**Positive:** predictable mutations, safer orchestration, clear query/command distinction.  
**Negative:** write flows require an extra interaction.

## Guardrail
Conversational confirmation belongs to the Host, not Finance MCP.
