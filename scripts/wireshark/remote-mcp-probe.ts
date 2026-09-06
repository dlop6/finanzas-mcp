import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REMOTE_MCP_PROTOCOL_VERSION = "2025-11-25";

export type RemoteMcpProbeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class RemoteMcpProbeError extends Error {
  constructor(public readonly code: "INVALID_ENDPOINT" | "HTTP_ERROR" | "INVALID_RESPONSE") {
    super("Remote MCP capture probe failed.");
    this.name = "RemoteMcpProbeError";
  }
}

function validateEndpoint(value: string): URL {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:" || endpoint.pathname !== "/mcp" || endpoint.search || endpoint.hash) throw new Error();
    return endpoint;
  } catch {
    throw new RemoteMcpProbeError("INVALID_ENDPOINT");
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new RemoteMcpProbeError("HTTP_ERROR");
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RemoteMcpProbeError) throw error;
    throw new RemoteMcpProbeError("INVALID_RESPONSE");
  }
}

function jsonRequest(id: number, method: string, params: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function requestHeaders(sessionId?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(sessionId === undefined ? {} : {
      "MCP-Protocol-Version": REMOTE_MCP_PROTOCOL_VERSION,
      "MCP-Session-Id": sessionId,
    }),
  };
}

export async function runRemoteMcpProbe(endpointValue: string, request: RemoteMcpProbeFetch = globalThis.fetch): Promise<void> {
  const endpoint = validateEndpoint(endpointValue).toString();
  let sessionId: string | null = null;
  try {
    const initialized = await request(endpoint, {
      method: "POST", headers: requestHeaders(), body: jsonRequest(1, "initialize", {
        protocolVersion: REMOTE_MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "wireshark-capture-probe", version: "1.0.0" },
      }),
    });
    const initializeBody = await readJson(initialized);
    sessionId = initialized.headers.get("mcp-session-id");
    if (!sessionId || "error" in initializeBody) throw new RemoteMcpProbeError("INVALID_RESPONSE");
    const headers = requestHeaders(sessionId);
    const notification = await request(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) });
    if (notification.status !== 202) throw new RemoteMcpProbeError("HTTP_ERROR");
    const tools = await readJson(await request(endpoint, { method: "POST", headers, body: jsonRequest(2, "tools/list", {}) }));
    const definitions = (tools.result as { tools?: unknown } | undefined)?.tools;
    if (!Array.isArray(definitions) || definitions.length !== 30 || "error" in tools) throw new RemoteMcpProbeError("INVALID_RESPONSE");
    const balance = await readJson(await request(endpoint, { method: "POST", headers, body: jsonRequest(3, "tools/call", { name: "get_current_balance", arguments: {} }) }));
    if ("error" in balance || (balance.result as { isError?: unknown } | undefined)?.isError === true) throw new RemoteMcpProbeError("INVALID_RESPONSE");
  } finally {
    if (sessionId) {
      await request(endpoint, { method: "DELETE", headers: { "MCP-Protocol-Version": REMOTE_MCP_PROTOCOL_VERSION, "MCP-Session-Id": sessionId } }).catch(() => undefined);
    }
  }
}

const isEntrypoint = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  runRemoteMcpProbe(process.argv[2] ?? "")
    .then(() => process.stdout.write("Remote MCP capture probe completed: 30 tools and one read operation.\n"))
    .catch((error: unknown) => {
      const code = error instanceof RemoteMcpProbeError ? error.code : "INVALID_RESPONSE";
      process.stderr.write(`Remote MCP capture probe failed: ${code}.\n`);
      process.exitCode = 1;
    });
}
