import { NextRequest, NextResponse } from "next/server";

import { getMcpAppConfigs } from "@/app/lib/server/mcp-apps";
import { readMcpSession } from "@/app/lib/server/mcp-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    apps: getMcpAppConfigs().map((app) => {
      const session = readMcpSession(request, app.id);

      return {
        id: app.id,
        label: app.label,
        authMode: app.authMode,
        configured: Boolean(app.mcpUrl),
        oauthConfigured: Boolean(app.authServer),
        envAccessTokenConfigured: Boolean(app.accessToken),
        usesEnvToken: Boolean(app.accessToken),
        connected: Boolean(session?.accessToken || app.accessToken),
        expiresAt: session?.expiresAt,
      };
    }),
  });
}
