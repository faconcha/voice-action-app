import { NextResponse } from "next/server";

import { parseMcpAppId, clearMcpSession } from "@/app/lib/server/mcp-oauth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ app: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { app: rawAppId } = await context.params;
  const appId = parseMcpAppId(rawAppId);
  const response = NextResponse.json({ ok: true });

  clearMcpSession(response, appId);

  return response;
}
