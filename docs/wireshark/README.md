# Remote MCP Wireshark validation

This directory documents safe, reproducible TLS captures for the public Finance MCP. All probes are read-only and their capture artifacts remain local.

## Create a local capture

List interfaces first:

```powershell
& "C:\Program Files\Wireshark\tshark.exe" -D
```

Then run the probe with the chosen interface:

```powershell
npm run wireshark:remote:capture -- --interface 6 https://finanzas-mcp-server.onrender.com/mcp
```

The probe performs `initialize`, `notifications/initialized`, `tools/list`, `get_current_balance`, and `DELETE /mcp`. It never calls a write tool.

Local `.pcapng`, TLS key-log and tshark-log files are created under `docs/wireshark/local/`. They are intentionally ignored by Git. Delete the key log after analysis.

## Capture the Host remote client

UN-44 uses the production Host client rather than the temporary HTTP probe:

```powershell
npm run wireshark:host-remote:capture -- --interface 6 https://finanzas-mcp-server.onrender.com/mcp
```

It creates a separate `host-remote-preliminary-*` capture, TLS key log, and safe Host-log summary under `docs/wireshark/local/`. The launcher limits capture to the resolved endpoint IP addresses on TCP port 443. See `remote-host-preliminary-report.md` for the preliminary evidence.

## Capture the final Host session

UN-55 uses the same production Host client and fixed read-only probe, but creates separate final evidence:

```powershell
npm run wireshark:host-remote:final-capture -- --interface <interface> https://finanzas-mcp-server.onrender.com/mcp
```

List interfaces first and select the active one explicitly; do not assume a fixed index. The command creates `host-remote-final-*` artifacts under `docs/wireshark/local/`, including a `.pcapng`, a TLS key log, TShark diagnostics, and a safe Host-log summary. It discovers 24 tools and calls only `get_current_balance` before closing the remote session.

Keep the final TLS key log local until the follow-up classification and layer-analysis work is complete. Never commit it, the capture, or TShark diagnostics. See `remote-host-final-capture.md` for the versioned, safe evidence metadata.

## Inspect the encrypted flow

Before loading the key log, use these display filters:

```text
tcp.port == 443
tls.handshake.extensions_server_name contains "finanzas-mcp-server.onrender.com"
ip.addr == <observed Render IP>
```

The TLS Application Data is expected to be encrypted and JSON-RPC is not readable at this stage.

## Decrypt locally

In Wireshark, open **Edit → Preferences → Protocols → TLS** and set **(Pre)-Master-Secret log filename** to the local key-log path emitted by the command. Then inspect the matching TCP stream with:

```text
http
tcp.stream == <matching stream>
```

The decrypted stream should contain the lifecycle, tool discovery and read-only `tools/call` sequence. Do not copy session IDs, full payloads or TLS keys into documentation.

## Evidence

`remote-capture-report.md` records the temporary-probe evidence, `remote-host-preliminary-report.md` records UN-44, and `remote-host-final-capture.md` records the final UN-55 capture. `final-mcp-message-classification.md` classifies the final MCP and JSON-RPC exchange for UN-56, while `final-remote-layer-analysis.md` documents the UN-57 link, network, transport, TLS, and application-layer evidence. Each report contains only safe metadata, filters, findings, and hashes; captures and key logs are not committed.
