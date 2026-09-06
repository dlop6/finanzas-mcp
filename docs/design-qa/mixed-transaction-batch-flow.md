# Mixed transaction batch flow design QA

## Objective

Verify that a combined income and expense request is prepared as one understandable, atomic operation without asking the user for internal identifiers or splitting the decision into separate confirmations.

## Interaction model

- The Host converts related income and expense proposals into one `record_mixed_transactions_batch` pending operation.
- The confirmation preserves source order and adds a textual transaction type for every row.
- Accounts and categories are resolved through Finance MCP before the card is created.
- The card states that every row is written in one transaction or none is written.
- The browser sends only the stored session identifier and the confirmation decision.
- The technical arguments remain available under progressive disclosure and retain internal IDs.

## HCI and accessibility review

- The full preview uses a caption and scoped column headers.
- Type is expressed as `Ingreso` or `Gasto`, not only through color.
- The confirmation heading receives focus instead of the execution button.
- Confirmation, rejection, cancellation, and uncertain execution remain visibly distinct.
- The table wrapper is keyboard focusable when horizontal containment is required.
- The preview retains its source order on desktop, tablet, and mobile layouts.
- The existing 25-row maximum constrains review length without pagination.

## Validation

- Unit tests cover mixed normalization, flattening of a homogeneous batch with an individual transaction, reference resolution, literal preview rendering, and the existing confirmation protocol.
- Finance integration covers a successful mixed batch and a rejected mixed batch with no partial write.
- The local Streamable HTTP suite verifies the current Finance MCP catalog.
- Remote validation remains read-only and is not used to execute the new write tool.

## Findings and resolutions

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | Mixed income and expense proposals were rejected before Finance MCP could receive a coherent operation. | The Host normalizes supported transaction proposals into one mixed batch. |
| P1 | The previous explanation treated different expense categories as incompatible with a batch. | The shared Host instructions now distinguish transaction type from account or category selection. |
| P2 | Separate confirmations would allow only partial completion of the original intent. | One confirmation executes one Finance MCP call and one database transaction. |
| P2 | A reviewer could not distinguish rows of different kinds in one preview. | The mixed preview adds a visible Type column while retaining the original order. |

All P0, P1, and P2 findings are resolved.

final result: passed
