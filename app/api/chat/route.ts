import { createWebChatHandler, getWebHostRuntime, installWebHostShutdownHooks } from "@/host/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

installWebHostShutdownHooks();

const handleChat = createWebChatHandler(getWebHostRuntime);

export async function POST(request: Request): Promise<Response> {
  return handleChat(request);
}
