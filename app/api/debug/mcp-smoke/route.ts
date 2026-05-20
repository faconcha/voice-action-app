import { promises as fs } from "node:fs";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
  dispatchToolCall,
  persistRefreshedSession,
} from "@/app/lib/server/tool-dispatcher";
import { listAppMcpTools } from "@/app/lib/server/mcp-client";
import { getValidMcpSession } from "@/app/lib/server/mcp-oauth";
import type { AllowedToolName } from "@/app/lib/shared/tools";

export const runtime = "nodejs";

type SmokeStep = {
  label: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type SmokeStepWithSession = SmokeStep & {
  refreshedSession?: Awaited<ReturnType<typeof dispatchToolCall>>["refreshedSession"];
};

async function inspectAppTools(request: NextRequest, label: string) {
  try {
    const appId = label === "Notion" ? "notion" : "google-calendar";
    const { session } = await getValidMcpSession(request, appId);
    const tools = await listAppMcpTools(appId, session.accessToken);

    return {
      label: `${label} MCP tools`,
      ok: true,
      result: tools,
    };
  } catch (error) {
    return {
      label: `${label} MCP tools`,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const REPORT_PATH = path.join(
  process.cwd(),
  "local_example",
  "mcp-browser-smoke-report.json",
);

function tomorrowNoon() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(12, 0, 0, 0);

  const end = new Date(start);
  end.setHours(start.getHours() + 1);

  return {
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  };
}

async function runStep(
  request: NextRequest,
  label: string,
  name: AllowedToolName,
  args: unknown,
): Promise<SmokeStepWithSession> {
  try {
    const { result, refreshedSession } = await dispatchToolCall(
      request,
      name,
      args,
    );

    return {
      label,
      ok: result.ok,
      result,
      refreshedSession,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runSmoke(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Disabled in production." },
      { status: 403 },
    );
  }

  const calendarTimes = tomorrowNoon();
  const inspections = await Promise.all([
    inspectAppTools(request, "Notion"),
    inspectAppTools(request, "Google Calendar"),
  ]);
  const steps = await Promise.all([
    runStep(request, "Notion list recent ideas", "list_recent_ideas", {
      limit: 3,
    }),
    runStep(request, "Google Calendar list events", "list_calendar_events", {
      limit: 5,
    }),
  ]);

  steps.push(
    await runStep(request, "Notion create page in Sandbox de Ideas", "create_notion_page", {
      rawText: "MCP browser smoke test - safe to delete",
      title: "MCP browser smoke test - safe to delete",
      destinationHint: "Sandbox de Ideas",
      tags: ["mcp-smoke-test"],
      nextAction: "Delete this page",
      priority: "low",
    }),
  );

  steps.push(
    await runStep(request, "Google Calendar create event", "create_calendar_event", {
      title: "MCP browser smoke test - DELETE ME",
      ...calendarTimes,
      timeZone: process.env.APP_DEFAULT_TIMEZONE ?? "America/Santiago",
      description:
        "Created by /api/debug/mcp-smoke in Voice Action App. Safe to delete.",
    }),
  );

  const report = {
    ok: steps.every((step) => step.ok),
    startedAt: new Date().toISOString(),
    reportPath: REPORT_PATH,
    inspections,
    steps: steps.map<SmokeStep>((step) => ({
      label: step.label,
      ok: step.ok,
      result: step.result,
      error: step.error,
    })),
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const response = NextResponse.json(report, {
    status: report.ok ? 200 : 207,
  });

  for (const step of steps) {
    persistRefreshedSession(response, step.refreshedSession);
  }

  return response;
}

export async function GET(request: NextRequest) {
  return runSmoke(request);
}

export async function POST(request: NextRequest) {
  return runSmoke(request);
}
