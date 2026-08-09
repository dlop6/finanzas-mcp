import type { JsonRpcId, JsonRpcSuccessResponse } from "./index";

export function createJsonRpcSuccessResponse<Result = unknown>(
  id: JsonRpcId,
  result: Result,
): JsonRpcSuccessResponse<Result> {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}
