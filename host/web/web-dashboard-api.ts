import { WebFinancialDashboardError } from "./financial-dashboard";
import type { WebFinanceRuntime } from "./web-host-runtime";

export type WebDashboardErrorCode = "INVALID_REQUEST" | "HOST_UNAVAILABLE" | "DASHBOARD_FAILED";

export type WebDashboardErrorResponse = {
  error: { code: WebDashboardErrorCode; message: string };
};

export type WebDashboardRuntimeProvider = () => Promise<Pick<WebFinanceRuntime, "dashboard">>;

function errorResponse(status: number, code: WebDashboardErrorCode, message: string): Response {
  return Response.json({ error: { code, message } } satisfies WebDashboardErrorResponse, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createWebDashboardHandler(getRuntime: WebDashboardRuntimeProvider) {
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).search) {
      return errorResponse(400, "INVALID_REQUEST", "La solicitud del resumen financiero no es válida.");
    }
    let runtime: Pick<WebFinanceRuntime, "dashboard">;
    try {
      runtime = await getRuntime();
    } catch {
      return errorResponse(503, "HOST_UNAVAILABLE", "El resumen financiero no está disponible en este momento.");
    }
    try {
      const body = await runtime.dashboard.getDashboard();
      return Response.json(body, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof WebFinancialDashboardError) {
        return errorResponse(502, "DASHBOARD_FAILED", "No fue posible obtener el resumen financiero.");
      }
      return errorResponse(502, "DASHBOARD_FAILED", "No fue posible obtener el resumen financiero.");
    }
  };
}
