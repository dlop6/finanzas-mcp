import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  createInternalErrorResponse,
  createInvalidRequestResponse,
  createMethodNotFoundResponse,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcErrorResponse,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
} from "@/shared/jsonrpc";

export type FinanceMcpMessageHandler = (
  message: JsonRpcRequest | JsonRpcNotification,
) =>
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | undefined
  | Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined>;

export interface FinanceMcpStdioServerOptions {
  handleMessage: FinanceMcpMessageHandler;
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
}

function writeDiagnostic(diagnostics: Writable, message: string): void {
  diagnostics.write(`${message}\n`);
}

function writeMessage(output: Writable, message: JsonRpcSuccessResponse | JsonRpcErrorResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(`${serializeJsonRpcMessage(message)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function isMatchingResponse(
  response: JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined,
  request: JsonRpcRequest,
): response is JsonRpcSuccessResponse | JsonRpcErrorResponse {
  return (
    response !== undefined &&
    (isJsonRpcSuccessResponse(response) || isJsonRpcErrorResponse(response)) &&
    response.id === request.id
  );
}

async function handleLine(
  line: string,
  handleMessage: FinanceMcpMessageHandler,
  output: Writable,
  diagnostics: Writable,
): Promise<void> {
  const parsed = parseJsonRpcMessage(line);

  if (!parsed.ok) {
    await writeMessage(output, parsed.error);
    return;
  }

  const { message } = parsed;

  if (isJsonRpcNotification(message)) {
    try {
      await handleMessage(message);
    } catch {
      writeDiagnostic(diagnostics, "Finance MCP notification handler failed");
    }
    return;
  }

  if (!isJsonRpcRequest(message)) {
    await writeMessage(output, createInvalidRequestResponse(message.id));
    return;
  }

  try {
    const response = await handleMessage(message);

    if (!isMatchingResponse(response, message)) {
      writeDiagnostic(diagnostics, "Finance MCP handler returned an invalid response");
      await writeMessage(output, createInternalErrorResponse(message.id));
      return;
    }

    await writeMessage(output, response);
  } catch {
    writeDiagnostic(diagnostics, "Finance MCP request handler failed");
    await writeMessage(output, createInternalErrorResponse(message.id));
  }
}

export async function runFinanceMcpStdioServer({
  handleMessage,
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
}: FinanceMcpStdioServerOptions): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    await handleLine(line, handleMessage, output, diagnostics);
  }
}

export function createMethodNotFoundHandler(): FinanceMcpMessageHandler {
  return (message) => (isJsonRpcRequest(message) ? createMethodNotFoundResponse(message.id) : undefined);
}
