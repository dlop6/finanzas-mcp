import { describe, expect, it } from "vitest";
import type {
  JsonRpcErrorObject,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from "@/shared/jsonrpc";

const request: JsonRpcRequest<{ accountId: number }> = {
  jsonrpc: "2.0",
  id: "request-1",
  method: "accounts.get",
  params: { accountId: 1 },
};

const notification: JsonRpcNotification<{ event: string }> = {
  jsonrpc: "2.0",
  method: "accounts.refresh",
  params: { event: "manual" },
};

const successResponse: JsonRpcSuccessResponse<{ balance: number }> = {
  jsonrpc: "2.0",
  id: request.id,
  result: { balance: 1500 },
};

const errorObject: JsonRpcErrorObject<{ field: string }> = {
  code: -32602,
  message: "Invalid params",
  data: { field: "accountId" },
};

const errorResponse: JsonRpcErrorResponse<{ field: string }> = {
  jsonrpc: "2.0",
  id: null,
  error: errorObject,
};

describe("JSON-RPC shared contracts", () => {
  it("distinguishes requests from notifications and responses by their fields", () => {
    expect(request.jsonrpc).toBe("2.0");
    expect("id" in request).toBe(true);
    expect("id" in notification).toBe(false);
    expect(successResponse).toEqual({
      jsonrpc: "2.0",
      id: "request-1",
      result: { balance: 1500 },
    });
    expect("error" in successResponse).toBe(false);
    expect(errorResponse).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: errorObject,
    });
    expect("result" in errorResponse).toBe(false);
  });
});
