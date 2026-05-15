export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getRealtimeConfig() {
  return {
    apiKey: requireEnv("OPENAI_API_KEY"),
    model: process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
    voice: process.env.OPENAI_REALTIME_VOICE ?? "marin",
  };
}

export function getNotionMcpConfig() {
  return {
    url: process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
    accessToken: process.env.NOTION_MCP_ACCESS_TOKEN,
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
    },
  };
}
