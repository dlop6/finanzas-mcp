import { createInterface } from "node:readline";
import {
  createJsonRpcSuccessResponse,
  createMethodNotFoundResponse,
  isJsonRpcRequest,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
} from "@/shared/jsonrpc";

function writeLine(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function handleLine(line: string): Promise<void> {
  const parsed = parseJsonRpcMessage(line);

  if (!parsed.ok) {
    writeLine(parsed.error);
    return;
  }

  if (!isJsonRpcRequest(parsed.message)) {
    return;
  }

  const request = parsed.message;
  const params = request.params as { value?: string; delayMs?: number } | undefined;

  if (request.method === "test/echo") {
    await delay(params?.delayMs ?? 0);
    writeLine(createJsonRpcSuccessResponse(request.id, params?.value ?? ""));
    return;
  }

  if (request.method === "test/stderr") {
    process.stderr.write("fixture diagnostic\n");
    writeLine(createJsonRpcSuccessResponse(request.id, "ok"));
    return;
  }

  if (request.method === "test/crash") {
    process.exitCode = 1;
    process.exit();
    return;
  }

  if (request.method === "test/invalid-json") {
    process.stdout.write("not-json\n");
    return;
  }

  if (request.method === "test/unknown-id") {
    process.stdout.write(`${serializeJsonRpcMessage(createJsonRpcSuccessResponse(999_999, "unknown"))}\n`);
    return;
  }

  writeLine(createMethodNotFoundResponse(request.id));
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  void handleLine(line);
}
