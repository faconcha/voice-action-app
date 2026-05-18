import { NextRequest, NextResponse } from "next/server";

import { getMcpAppConfig } from "@/app/lib/server/mcp-apps";
import { parseMcpAppId, readMcpSession } from "@/app/lib/server/mcp-oauth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ app: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { app: rawAppId } = await context.params;
  const appId = parseMcpAppId(rawAppId);
  const app = getMcpAppConfig(appId);
  const session = readMcpSession(request, appId);

  return NextResponse.json({
    id: app.id,
    label: app.label,
    authMode: app.authMode,
    configured: Boolean(app.mcpUrl),
    oauthConfigured: Boolean(app.authServer),
    envAccessTokenConfigured: Boolean(app.accessToken),
    usesEnvToken: Boolean(app.accessToken),
    connected: Boolean(session?.accessToken || app.accessToken),
    expiresAt: session?.expiresAt,
  });
}
