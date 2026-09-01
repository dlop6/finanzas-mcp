# Final remote Host MCP capture

## Scope

This is the UN-55 final capture evidence for a real production Host client session against the public Finance MCP. It is distinct from the temporary-probe evidence in `remote-capture-report.md` and the preliminary Host capture in `remote-host-preliminary-report.md`.

- Endpoint: `https://finanzas-mcp-server.onrender.com/mcp`
- Capture date: 2026-09-01T05:27:38Z
- MCP protocol: `2025-11-25`
- Transport: Streamable HTTP over TLS
- Interface: Wi-Fi (`6`), selected after listing available interfaces
- Local IP: `192.168.1.38`
- Remote IP: `216.24.57.15:443`
- Capture SHA-256: `0514c9bf96b8872efe3c83c14e1ed74dc9be7ab6d8d67f0a4887fc36073f943d`
- Safe Host-summary SHA-256: `1466b60a19a95ae41a5e171cb6d2b6725e8512c16076f0d519df4e9328fff528`

The `.pcapng`, TLS key log, TShark diagnostics, and safe Host-summary are local ignored artifacts under `docs/wireshark/local/`. This report deliberately excludes MCP session IDs, HTTP headers, complete JSON-RPC payloads, and financial values.

## Reproduction

First list interfaces and select the active one explicitly:

```powershell
& "C:\Program Files\Wireshark\tshark.exe" -D
```

Then capture the final read-only session:

```powershell
npm run wireshark:host-remote:final-capture -- --interface <interface> https://finanzas-mcp-server.onrender.com/mcp
```

The launcher resolves the endpoint at runtime and restricts capture to its resolved IP addresses on TCP port `443`. The filter used for this capture was:

```text
tcp port 443 and (host 216.24.57.15)
```

The production Host client initializes the MCP lifecycle, discovers exactly 24 tools (15 writes and 9 reads), executes only `get_current_balance`, and closes the remote session. No DeepSeek, direct PostgreSQL access, or write tool is used.

## Encrypted observation

Before loading the local TLS key log, the following filters identified the connection:

```text
tcp.port == 443
tls.handshake.extensions_server_name contains "finanzas-mcp-server.onrender.com"
ip.addr == 216.24.57.15
tcp.stream == <observed stream>
```

The capture contains TLS handshakes and encrypted Application Data. JSON-RPC is not readable until the local client-side TLS key log is supplied to Wireshark or TShark.

## Decrypted completeness and Host correlation

Configure Wireshark at **Edit → Preferences → Protocols → TLS → (Pre)-Master-Secret log filename** with the local key log. TShark may use the same local file through `-o tls.keylog_file:<key-log-local>`.

| Frames | TCP stream | HTTP | Correlated Host interaction | Status |
|---|---:|---|---|---:|
| 13 / 15 | 0 | `POST /mcp` | `HOST`: `initialize`, JSON-RPC ID 1 | 200 |
| 16 / 18 | 0 | `POST /mcp` | `HOST`: `notifications/initialized` | 202 |
| 31 / 35 | 1 | `POST /mcp` | `HOST`: `tools/list`, JSON-RPC ID 2 | 200 |
| 37 / 39 | 0 | `POST /mcp` | `PROBE_SESSION`: `tools/call` `get_current_balance`, JSON-RPC ID 3 | 200 |
| 40 / 42 | 0 | `DELETE /mcp` | Remote MCP session close | 204 |

The safe Host summary records the lifecycle and discovery under `HOST`, and the one read call under `PROBE_SESSION`. It confirms `STREAMABLE_HTTP`, a ready lifecycle, 24 discovered tools, and the single successful `get_current_balance` call. No write tool appears in the session.

Useful display filters after decryption:

```text
http.request or http.response
tcp.stream == 0
tcp.stream == 1
```

## Handoff to UN-56 and UN-57

This ticket establishes final capture completeness and safe Host correlation. UN-56 classifies the captured JSON-RPC/MCP messages in `final-mcp-message-classification.md`, and UN-57 documents the link, network, transport, TLS, and application evidence in `final-remote-layer-analysis.md`.

The matching TLS key log and `.pcapng` remained local until those two follow-up tickets completed. They are intentionally ignored by Git and were never committed. The TLS key log is deleted after the analysis; that deletion is irreversible. The `.pcapng` and safe Host summary remain local evidence linked to this report by their hashes.
