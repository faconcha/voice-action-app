import type { NextRequest, NextResponse } from "next/server";

import { callGoogleCalendarTool } from "@/app/lib/server/google-calendar-mcp";
import {
  getValidMcpSession,
  setMcpSession,
  type McpSession,
} from "@/app/lib/server/mcp-oauth";
import { callVoiceInboxTool } from "@/app/lib/server/notion-mcp";
import type { McpAppId } from "@/app/lib/server/mcp-apps";
import type { AllowedToolName, RecentIdea } from "@/app/lib/shared/tools";

type NormalizedToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
  recentItems?: RecentIdea[];
};

type DispatchResult = {
  result: NormalizedToolResult;
  refreshedSession?: {
    appId: McpAppId;
    session: McpSession;
  };
};

const notionToolNames = new Set<AllowedToolName>([
  "create_notion_page",
  "append_note",
  "list_recent_ideas",
]);

const googleCalendarToolNames = new Set<AllowedToolName>([
  "create_calendar_event",
  "list_calendar_events",
]);

async function getAccessTokenForTool(
  request: NextRequest,
  appId: McpAppId,
) {
  const { session, refreshed } = await getValidMcpSession(request, appId);

  return {
    accessToken: session.accessToken,
    refreshedSession: refreshed ? { appId, session } : undefined,
  };
}

export async function dispatchToolCall(
  request: NextRequest,
  name: AllowedToolName,
  rawArgs: unknown,
): Promise<DispatchResult> {
  if (notionToolNames.has(name)) {
    const { accessToken, refreshedSession } = await getAccessTokenForTool(
      request,
      "notion",
    );

    return {
      result: await callVoiceInboxTool(name, rawArgs, accessToken),
      refreshedSession,
    };
  }

  if (googleCalendarToolNames.has(name)) {
    const { accessToken, refreshedSession } = await getAccessTokenForTool(
      request,
      "google-calendar",
    );

    return {
      result: await callGoogleCalendarTool(name, rawArgs, accessToken),
      refreshedSession,
    };
  }

  throw new Error(`No MCP app registered for tool "${name}".`);
}

export function persistRefreshedSession(
  response: NextResponse,
  refreshedSession?: DispatchResult["refreshedSession"],
) {
  if (refreshedSession) {
    setMcpSession(
      response,
      refreshedSession.appId,
      refreshedSession.session,
    );
  }
}
