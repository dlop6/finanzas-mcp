# UN-50 — Write confirmation QA

## Objective

Validate explicit, inline confirmation controls for every Web chat write while preserving the Host as the only authority for the pending operation.

## HCI decisions

- The card exposes the Host description, server, tool, and an on-demand exact argument view before any write can run.
- The composer is disabled while a decision is pending, preventing ambiguous text turns and competing actions.
- Confirm and cancel are native buttons. The confirmation heading, not the riskier confirm action, receives initial focus.
- Pending, processing, confirmed, cancelled, and unavailable states use text as well as the existing neobrutalist color tokens.
- Arguments remain literal text in a contained scrolling region; they are never interpreted as HTML or Markdown.

## Review scope

- Servers: Finance MCP, Filesystem MCP, Git MCP.
- Viewports: 1440 × 900, 768 × 1024, 390 × 844.
- Keyboard: Tab, Enter, Space, focus restoration, and no Escape shortcut.
- Accessibility: labeled control group, visible focus, live processing state, alert errors, 200% zoom, and reduced motion.

## Findings and corrections

- P1 — Text-only approval required users to remember a command. Replaced with explicit inline controls.
- P1 — Browser could resend arguments in a future implementation. The API now accepts a decision-only request and resolves the stored Host operation.
- P2 — A pending operation allowed competing chat text. The composer is locked until the card resolves.
- P2 — Repeated confirmation could appear actionable. Processing disables both controls, and a missing pending operation resolves to a non-actionable error state.
- P3 — Long argument payloads could harm mobile scanning. They remain collapsed by default and scroll only inside their own container.

## Limitations

This MVP intentionally omits editing arguments, multiple pending operations, automatic retries, undo, and confirmation persistence.

final result: passed
