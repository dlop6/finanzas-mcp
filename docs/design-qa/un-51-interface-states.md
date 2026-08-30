# UN-51 — Interface states and HCI QA

## Objective

Validate the Web workspace states that complete the existing dashboard, chat, logs, and write-confirmation flows without changing their server contracts.

## Scope reviewed

- Global unexpected-error recovery.
- Dashboard total failure and refresh feedback.
- Chat send failure, preserved draft, and composer focus recovery.
- Logs refresh feedback and the distinction between an empty context and an empty filtered result.
- Responsive workspace navigation.

## HCI decisions verified

- **Visibility of system status:** loading, refresh, partial failure, and recovery actions use explicit text rather than color alone.
- **Recognition over recall:** empty filtered logs state that the active filters caused the result; users do not need to infer it from an empty list.
- **User control and recovery:** failed chat submissions preserve the unsent draft and remove the unconfirmed optimistic bubble; retry actions remain explicit.
- **Error prevention:** a failed request is never presented as an accepted chat message or completed action.
- **Consistency:** all new notices reuse the established neobrutalist tokens, borders, solid shadows, focus treatment, and Spanish language.

## Viewports and states inspected

| Viewport | States inspected | Result |
| --- | --- | --- |
| 1440 × 900 | Workspace hierarchy, dashboard failure recovery, logs metadata | Usable |
| 768 × 1024 | Tabs, content density, notice actions | Usable |
| 390 × 844 | Three tabs, status notices, no global horizontal overflow | Usable after correction |

The local browser review used generated local evidence only; no screenshots, payloads, session identifiers, or configuration values are versioned.

## Accessibility review

- Global error recovery moves focus to its heading and offers a native retry button.
- Refresh feedback is announced through concise live status text.
- Error notices use `role="alert"`; informational status uses `role="status"`.
- Tab controls retain keyboard navigation and visible focus.
- Actions and state labels remain understandable without relying on color.
- The mobile tab bar uses an equal three-column grid so all tabs remain reachable at narrow widths.
- Reduced-motion preferences continue to suppress nonessential transitions.

## Findings and corrections

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | At 390 px, the third workspace tab could require horizontal scrolling to reach. | Replaced the narrow-screen scrolling tab strip with a three-column grid and allowed labels to wrap. |
| P2 | A failed chat request could leave an optimistic user bubble even though the Host had not accepted it. | Remove the optimistic bubble, preserve the draft, surface a recoverable error, and restore composer focus. |
| P2 | An empty Logs MCP group did not explain whether no events existed or the current filters removed all entries. | Add a deterministic filtered-empty explanation while preserving context-specific empty states. |
| P2 | Refresh state was visible but not consistently announced to assistive technology. | Add concise live status updates for dashboard and logs refreshes. |

No P0, P1, or P2 issues remain open. P3 cosmetic refinements were not required for this scope.

## Limitations

- This review follows WCAG 2.2 AA practices; it is not a formal accessibility certification.
- Local runtime configuration can make the dashboard unavailable; that condition was used to validate the total-error recovery state and does not disclose configuration details.
- The scope does not add cross-device session persistence, automatic retries, background polling, or a global support system.

final result: passed
