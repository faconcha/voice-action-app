export const mcpAppIds = ["notion", "google-calendar"] as const;

export type McpAppId = (typeof mcpAppIds)[number];

export type McpToolNames = {
  createPage?: string;
  appendNote?: string;
  listRecent?: string;
  fetch?: string;
  createEvent?: string;
  listEvents?: string;
};

export type McpAppConfig = {
  id: McpAppId;
  label: string;
  authMode: "oauth" | "bearer-token";
  cookieKey: string;
  mcpUrl: string;
  authServer: string;
  setupUrl?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  parentPageId?: string;
  toolNames: McpToolNames;
  toolCandidates: {
    createEvent?: string[];
    listEvents?: string[];
  };
};

function originFromUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function isMcpAppId(value: string): value is McpAppId {
  return mcpAppIds.includes(value as McpAppId);
}

export function getMcpAppConfig(appId: McpAppId): McpAppConfig {
  if (appId === "notion") {
    const mcpUrl = process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp";

    return {
      id: "notion",
      label: "Notion",
      authMode: "oauth",
      cookieKey: "notion",
      mcpUrl,
      authServer:
        process.env.NOTION_MCP_AUTH_SERVER ?? originFromUrl(mcpUrl),
      accessToken: process.env.NOTION_MCP_ACCESS_TOKEN,
      clientId: process.env.NOTION_MCP_CLIENT_ID,
      clientSecret: process.env.NOTION_MCP_CLIENT_SECRET,
      scope: process.env.NOTION_MCP_SCOPE,
      parentPageId: process.env.NOTION_PARENT_PAGE_ID,
      toolNames: {
        createPage:
          process.env.NOTION_MCP_CREATE_PAGE_TOOL ||
          "notion-create-pages",
        appendNote:
          process.env.NOTION_MCP_APPEND_NOTE_TOOL ||
          "notion-update-page",
        listRecent:
          process.env.NOTION_MCP_LIST_RECENT_TOOL ||
          "notion-search",
        fetch:
          process.env.NOTION_MCP_FETCH_TOOL ||
          "notion-fetch",
      },
      toolCandidates: {},
    };
  }

  const mcpUrl =
    process.env.GOOGLE_CALENDAR_MCP_URL ??
    "https://calendarmcp.ai/api/mcp";
  const authServer =
    process.env.GOOGLE_CALENDAR_MCP_AUTH_SERVER ??
    "";
  const createEvent = process.env.GOOGLE_CALENDAR_MCP_CREATE_EVENT_TOOL;
  const listEvents = process.env.GOOGLE_CALENDAR_MCP_LIST_EVENTS_TOOL;

  return {
    id: "google-calendar",
    label: "Google Calendar",
    authMode: "bearer-token",
    cookieKey: "google_calendar",
    mcpUrl,
    authServer,
    setupUrl: "https://calendarmcp.ai/",
    accessToken: process.env.GOOGLE_CALENDAR_MCP_ACCESS_TOKEN,
    clientId: process.env.GOOGLE_CALENDAR_MCP_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CALENDAR_MCP_CLIENT_SECRET,
    scope: process.env.GOOGLE_CALENDAR_MCP_SCOPE,
    toolNames: {
      createEvent,
      listEvents,
    },
    toolCandidates: {
      createEvent: [
        createEvent,
        "create_event",
        "create-event",
        "calendar-create-event",
        "google_calendar_create_event",
        "google-calendar-create-event",
        "create_calendar_event",
      ].filter((name): name is string => Boolean(name)),
      listEvents: [
        listEvents,
        "list_events",
        "list-events",
        "calendar-list-events",
        "google_calendar_list_events",
        "google-calendar-list-events",
        "list_calendar_events",
        "search_events",
        "search-events",
      ].filter((name): name is string => Boolean(name)),
    },
  };
}

export function getMcpAppConfigs() {
  return mcpAppIds.map(getMcpAppConfig);
}
