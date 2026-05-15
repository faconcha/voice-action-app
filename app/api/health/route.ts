import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    notionMcpConfigured: Boolean(process.env.NOTION_MCP_ACCESS_TOKEN),
    notionParentConfigured: Boolean(process.env.NOTION_PARENT_PAGE_ID),
    notionMcpUrl: process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
  });
}
