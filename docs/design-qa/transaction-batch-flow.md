# Transaction batch flow design QA

## Objective

Verify that a request for several homogeneous financial movements can be clarified, reviewed, confirmed, or cancelled without asking the user to interpret internal identifiers or losing the original request after a recoverable preparation failure.

## Verified interaction model

- The Host converts two to twenty-five homogeneous Finance transaction proposals into one pending `record_transactions_batch` operation.
- The confirmation card presents the batch type, atomicity notice, and every row in the source order.
- Each row presents the exact GTQ amount, complete date, verified account name, verified category name, and optional description.
- Internal account and category identifiers remain only in the collapsed technical arguments.
- Confirming sends only the stored operation through the Host. Cancelling sends no mutable MCP request.
- A Finance rejection changes the card to `RECHAZADA`. A transport failure changes it to `RESULTADO INCIERTO` and recommends a follow-up read before retrying.
- A preparation error keeps the original user message in the transcript, retains the draft, and exposes an `Editar mensaje` action.

## Accessibility and responsive review

- The batch preview uses a caption and column headers with explicit scope.
- The table wrapper has a keyboard focus target and accessible name when horizontal containment is necessary.
- The confirmation heading receives focus rather than the confirmation button.
- Status is communicated with text in addition to color.
- Confirmation controls keep native keyboard behavior and the card uses a polite live state while processing.
- Desktop preserves all six columns. Tablet permits controlled wrapping. Mobile confines any needed horizontal movement to the preview wrapper and stacks the decision controls.
- The component test suite validates literal text handling, safe technical arguments, the row preview, preserved failed messages, and decision requests without client-supplied arguments.

## Evidence and results

The implementation was inspected through the rendered workspace entry point and through deterministic component tests that exercise the complete confirmation state model. Finance integration checks validated batch creation and a rejected second row with no persisted partial records. The local Streamable HTTP integration and the local end-to-end regression also completed successfully.

The running local development process exposed unrelated font-download warnings and browser automation router initialization errors. They do not originate in the transaction batch flow, and production build validation completed successfully with the pre-existing dynamic tracing warnings for local MCP launchers.

## Findings and resolutions

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | Multiple individual write proposals were rejected before Finance MCP could receive a coherent operation. | Homogeneous proposals are normalized into one batch and one confirmation. |
| P1 | A generic chat failure removed the user's original clarification from the transcript. | Failed user messages remain visible, preserve the draft, and can be restored for editing. |
| P1 | A confirmation did not distinguish an accepted button click from a verified execution result. | The card now has executed, rejected, cancelled, and unknown result states. |
| P2 | A multi-row confirmation required opening technical JSON to compare movements. | A semantic preview table shows all rows by verified names while JSON remains progressive detail. |
| P3 | Large batches require scrolling on narrow screens. | The 25-row maximum and contained table wrapper keep the page layout stable without introducing pagination. |

All P0, P1, and P2 findings are resolved.

final result: passed
