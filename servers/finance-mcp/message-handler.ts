import type { JsonRpcErrorResponse, JsonRpcNotification, JsonRpcRequest, JsonRpcSuccessResponse } from "@/shared/jsonrpc";

export type FinanceMcpMessageHandler = (
  message: JsonRpcRequest | JsonRpcNotification,
) =>
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | undefined
  | Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined>;
