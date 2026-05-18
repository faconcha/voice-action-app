import { getMcpAppConfig } from "@/app/lib/server/mcp-apps";

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
  const config = getMcpAppConfig("notion");

  return {
    url: config.mcpUrl,
    accessToken: config.accessToken,
    parentPageId: config.parentPageId,
    toolNames: {
      createPage: config.toolNames.createPage ?? "notion-create-pages",
      appendNote: config.toolNames.appendNote ?? "notion-update-page",
      listRecent: config.toolNames.listRecent ?? "notion-search",
      fetch: config.toolNames.fetch ?? "notion-fetch",
    },
  };
}

export function getGoogleCalendarMcpConfig() {
  return getMcpAppConfig("google-calendar");
}
