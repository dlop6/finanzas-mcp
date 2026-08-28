# UN-49 MCP logs panel design QA

## Objective

Verify that the Web workspace exposes MCP traffic without overwhelming the financial workspace, leaking session identifiers, or changing the established neobrutalist visual language.

## Direction and HCI decisions

- The panel is a third accessible tab, so financial work and conversation remain focused.
- Logs are grouped by lifecycle/discovery, dashboard, and the current conversation instead of being merged into an ambiguous global timeline.
- Requests and responses expose persistent labels for server, transport, direction, method, ID, status, and duration.
- Payloads use progressive disclosure; protocol and transport errors are expanded by default.
- Refresh is deliberate and preserves prior data after a failed refresh.
- The panel reuses warm surfaces, black borders, solid shadows, Geist, and the existing teal/yellow/pink semantic accents.

## Reviewed states

| State | Result |
| --- | --- |
| Empty context | A specific explanatory empty state is shown. |
| Lifecycle and discovery | Initialize, notification, tools/list, request IDs, and responses are distinguishable. |
| Dashboard activity | Dashboard reads appear under `WEB_DASHBOARD` without opening Chat. |
| Current Chat | The browser receives only the alias `CHAT`, never the UUID. |
| Error entry | Error payload is expanded and status is presented with text and color. |
| Long payload | The code block scrolls internally without page-wide overflow. |
| Refresh failure | Existing events remain visible with a safe alert and retry path. |
| Desktop | Header, filters, and grouped cards remain scannable. |
| Tablet and mobile | Metadata reflows, filters wrap, controls retain a usable touch target, and payloads remain contained. |

## Accessibility checks

- One page `h1`; Logs MCP begins at `h2` and groups at `h3`.
- Workspace controls implement the tablist, tab, and tabpanel pattern with Arrow, Home, and End keys.
- Filter controls have visible labels and focus styles.
- Loading uses `aria-busy`; failures use `role="alert"`.
- Payload disclosure uses native `details` and `summary`.
- Status never relies on color alone.
- The content remains usable at 200% zoom and honors reduced-motion preferences.

## Findings

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | A dense raw timeline would make lifecycle and dashboard traffic difficult to scan. | Entries are grouped by their real context and retain original order only within that context. |
| P2 | Full payloads obscure the important request metadata in a long log. | Payloads remain collapsed except for error entries. |
| P2 | A Chat UUID could accidentally become visible when querying logs. | The server converts it to `CHAT` and omits `sessionId` from every public entry. |
| P3 | Long captured histories require scrolling. | This is retained intentionally because UN-49 excludes pagination and the filters reduce visible density. |

No browser capture, session identifier, payload, header, endpoint, or secret is versioned with this document.

final result: passed
