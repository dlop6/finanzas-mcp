import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from "@/shared/jsonrpc";

export type FinanceMcpJsonRpcMessage = JsonRpcRequest | JsonRpcNotification;
export type FinanceMcpJsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
