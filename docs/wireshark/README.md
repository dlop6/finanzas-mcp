# Remote MCP Wireshark validation

This directory documents the preliminary TLS capture for the public Finance MCP. It uses a temporary, read-only MCP probe; the Host remote client remains the responsibility of UN-42.

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

`remote-capture-report.md` records only safe metadata, filters, findings and the SHA-256 hash of the local capture. The capture and key log are not committed.
