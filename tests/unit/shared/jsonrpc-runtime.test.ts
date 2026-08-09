import { describe, expect, it } from "vitest";
import {
  createInternalErrorResponse,
  createInvalidParamsResponse,
  createJsonRpcRequestIdGenerator,
  createMethodNotFoundResponse,
  createJsonRpcSuccessResponse,
  JSON_RPC_ERROR_CODES,
  parseJsonRpcMessage,
} from "@/shared/jsonrpc";

function expectError(result: ReturnType<typeof parseJsonRpcMessage>, code: number) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected a JSON-RPC error response");
  }

  expect(result.error.error.code).toBe(code);
  return result.error;
}

describe("JSON-RPC parsing and validation", () => {
  it("returns parse error for malformed JSON without throwing", () => {
    const error = expectError(parseJsonRpcMessage("{"), JSON_RPC_ERROR_CODES.PARSE_ERROR);

    expect(error.id).toBeNull();
  });

  it("rejects invalid envelopes and empty methods", () => {
    expectError(parseJsonRpcMessage(JSON.stringify({ method: "accounts.get" })), JSON_RPC_ERROR_CODES.INVALID_REQUEST);
    expectError(parseJsonRpcMessage(JSON.stringify({ jsonrpc: "1.0", method: "accounts.get" })), JSON_RPC_ERROR_CODES.INVALID_REQUEST);
    expectError(parseJsonRpcMessage(JSON.stringify({ jsonrpc: "2.0", method: "   " })), JSON_RPC_ERROR_CODES.INVALID_REQUEST);
  });

  it("accepts requests and notifications with structured params only", () => {
    const request = parseJsonRpcMessage(
      JSON.stringify({ jsonrpc: "2.0", id: "request-7", method: "accounts.get", params: { accountId: 1 } }),
    );
    const notification = parseJsonRpcMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "accounts.refresh", params: ["manual"] }),
    );

    expect(request.ok).toBe(true);
    expect(notification.ok).toBe(true);
    expectError(
      parseJsonRpcMessage(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "accounts.get", params: null })),
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
    );
  });

  it("creates standardized method, params, and internal error responses", () => {
    expect(createMethodNotFoundResponse("request-1")).toMatchObject({
      jsonrpc: "2.0",
      id: "request-1",
      error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, message: "Method not found" },
    });
    expect(createInvalidParamsResponse(2).error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
    expect(createInternalErrorResponse(3)).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message: "Internal error" },
    });
  });

  it("generates monotonic IDs and preserves the request ID in responses", () => {
    const ids = createJsonRpcRequestIdGenerator();
    const firstId = ids.next();
    const secondId = ids.next();
    const response = createJsonRpcSuccessResponse(firstId, { ok: true });

    expect(secondId).toBe(firstId + 1);
    expect(response.id).toBe(firstId);
  });
});
