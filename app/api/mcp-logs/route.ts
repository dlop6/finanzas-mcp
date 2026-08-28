import { createWebMcpLogsHandler, getWebFinanceRuntime, installWebHostShutdownHooks } from "@/host/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

installWebHostShutdownHooks();

const handleMcpLogs = createWebMcpLogsHandler(getWebFinanceRuntime);

export async function POST(request: Request): Promise<Response> {
  return handleMcpLogs(request);
}
