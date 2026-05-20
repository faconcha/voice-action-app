import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as notionMcp from "@/app/lib/server/notion-mcp";
import * as calendarMcp from "@/app/lib/server/google-calendar-mcp";
import * as mcpApps from "@/app/lib/server/mcp-apps";
import {
  discoverMcpOAuthMetadata,
  registerMcpOAuthClient,
} from "@/app/lib/server/mcp-oauth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.resolve(__dirname, "mcp-test-report.txt");

const notionToken = process.env.NOTION_MCP_ACCESS_TOKEN?.trim();
const calendarToken = process.env.GOOGLE_CALENDAR_MCP_ACCESS_TOKEN?.trim();

const lines: string[] = [];

function record(label: string, payload: unknown) {
  lines.push(`--- ${label} ---`);
  lines.push(
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
  );
  lines.push("");
}

async function safeCall<T>(
  label: string,
  call: () => Promise<T>,
): Promise<void> {
  try {
    const result = await call();
    record(label, result);
  } catch (error) {
    record(
      `${label} (error)`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

const notionConfig = mcpApps.getMcpAppConfig("notion");
const calendarConfig = mcpApps.getMcpAppConfig("google-calendar");

record("Run", {
  startedAt: new Date().toISOString(),
  node: process.version,
});
record("Notion config", {
  mcpUrl: notionConfig.mcpUrl,
  parentPageId: notionConfig.parentPageId ?? null,
  tokenPresent: Boolean(notionToken),
});
record("Calendar config", {
  mcpUrl: calendarConfig.mcpUrl,
  defaultTimeZone: process.env.APP_DEFAULT_TIMEZONE ?? "America/Santiago",
  tokenPresent: Boolean(calendarToken),
});

for (const appId of mcpApps.mcpAppIds) {
  await safeCall(`${appId} OAuth discovery and dynamic registration`, async () => {
    const metadata = await discoverMcpOAuthMetadata(appId);
    const client = await registerMcpOAuthClient(
      appId,
      metadata,
      `http://localhost:3000/api/mcp/apps/${appId}/callback`,
    );

    return {
      authorizationEndpointPresent: Boolean(metadata.authorization_endpoint),
      tokenEndpointPresent: Boolean(metadata.token_endpoint),
      registrationEndpointPresent: Boolean(metadata.registration_endpoint),
      clientRegistered: Boolean(client.client_id),
    };
  });
}

if (notionToken) {
  await safeCall("Notion list_recent_ideas", () =>
    notionMcp.callVoiceInboxTool(
      "list_recent_ideas",
      { limit: 3 },
      notionToken,
    ),
  );

  await safeCall("Notion create_notion_page", () =>
    notionMcp.callVoiceInboxTool(
      "create_notion_page",
      {
        rawText: "MCP smoke test — safe to delete",
        title: "MCP smoke test — safe to delete",
        destinationHint: "Sandbox de Ideas",
        tags: ["mcp-smoke-test"],
        nextAction: "Delete this page",
        priority: "low",
      },
      notionToken,
    ),
  );
} else {
  record(
    "Notion",
    "NOTION_MCP_ACCESS_TOKEN missing in environment; skipping Notion calls.",
  );
}

if (calendarToken) {
  await safeCall("Calendar list_calendar_events", () =>
    calendarMcp.callGoogleCalendarTool(
      "list_calendar_events",
      { limit: 5 },
      calendarToken,
    ),
  );

  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);

  await safeCall("Calendar create_calendar_event", () =>
    calendarMcp.callGoogleCalendarTool(
      "create_calendar_event",
      {
        title: "MCP smoke test — DELETE ME",
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
        description: "Created by local_example/test-mcps.ts. Safe to delete.",
      },
      calendarToken,
    ),
  );
} else {
  record(
    "Calendar",
    "GOOGLE_CALENDAR_MCP_ACCESS_TOKEN missing in environment; skipping Google Calendar calls.",
  );
}

record("Run", { finishedAt: new Date().toISOString() });

await fs.writeFile(REPORT_PATH, lines.join("\n"), "utf8");
console.log(`Wrote ${REPORT_PATH}`);
