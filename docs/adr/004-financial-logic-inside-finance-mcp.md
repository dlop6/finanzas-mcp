# ADR-004 — Keep deterministic financial logic inside Finance MCP

**Status:** Accepted

## Context
The LLM can interpret language, but financial calculations must be reproducible, testable and auditable.

## Decision
All authoritative calculations live in Finance MCP:
- current balance;
- cash-flow summary;
- 7/30-day projection;
- purchase viability;
- inventory stock rules.

DeepSeek interprets intent and explains results, but does not calculate or override authoritative financial values.

## Consequences
**Positive:** deterministic results, unit-testable rules, lower LLM error risk.  
**Negative:** more explicit domain logic must be implemented.

## Guardrail
If an LLM explanation conflicts with Finance MCP output, Finance MCP is authoritative.
