import { createWebDashboardHandler, getWebFinanceRuntime, installWebHostShutdownHooks } from "@/host/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

installWebHostShutdownHooks();

const handleDashboard = createWebDashboardHandler(getWebFinanceRuntime);

export async function GET(request: Request): Promise<Response> {
  return handleDashboard(request);
}
