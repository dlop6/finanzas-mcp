import type {
  JsonRpcErrorResponse,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from "@/shared/jsonrpc";

export type HostJsonRpcRequest = JsonRpcRequest;
export type HostJsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
