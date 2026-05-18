import { NextResponse } from "next/server";

import { getMcpAppConfigs } from "@/app/lib/server/mcp-apps";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    mcpCookieSecretConfigured: Boolean(
      process.env.MCP_COOKIE_SECRET ?? process.env.NOTION_COOKIE_SECRET,
    ),
    mcpApps: getMcpAppConfigs().map((app) => ({
      id: app.id,
      label: app.label,
      authMode: app.authMode,
      configured: Boolean(app.mcpUrl),
      oauthConfigured: Boolean(app.authServer),
      envAccessTokenConfigured: Boolean(app.accessToken),
    })),
    notionCookieSecretConfigured: Boolean(process.env.NOTION_COOKIE_SECRET),
    notionMcpConfigured: Boolean(process.env.NOTION_MCP_ACCESS_TOKEN),
    notionParentConfigured: Boolean(process.env.NOTION_PARENT_PAGE_ID),
    notionMcpUrl: process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
  });
}
