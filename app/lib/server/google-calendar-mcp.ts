import {
  createCalendarEventSchema,
  listCalendarEventsSchema,
  type AllowedToolName,
} from "@/app/lib/shared/tools";
import { callFirstAvailableAppMcpTool } from "@/app/lib/server/mcp-client";
import { getGoogleCalendarMcpConfig } from "@/app/lib/server/env";
import {
  getTextContent,
  type McpToolResult,
} from "@/app/lib/server/notion-mcp-client";

const DEFAULT_TIMEZONE = process.env.APP_DEFAULT_TIMEZONE || "America/Santiago";
const LIST_DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type NormalizedToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

type ToolDescriptor = {
  name: string;
  inputSchema?: unknown;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null) {
        return false;
      }

      if (typeof item === "string") {
        return item.trim().length > 0;
      }

      if (Array.isArray(item)) {
        return item.length > 0;
      }

      return true;
    }),
  );
}

function getSchemaProperties(tool: ToolDescriptor) {
  const schema = toRecord(tool.inputSchema);
  const properties = toRecord(schema?.properties);

  return properties ? Object.keys(properties) : [];
}

function getSchemaRequired(tool: ToolDescriptor): string[] {
  const schema = toRecord(tool.inputSchema);
  const required = schema?.required;

  return Array.isArray(required) ? required.map(String) : [];
}

function attendeesForTool(tool: ToolDescriptor, attendees: string[]) {
  const schema = toRecord(tool.inputSchema);
  const properties = toRecord(schema?.properties);
  const attendeesSchema = toRecord(properties?.attendees);
  const items = toRecord(attendeesSchema?.items);

  if (toRecord(items?.properties)?.email) {
    return attendees.map((email) => ({ email }));
  }

  return attendees;
}

function shapeForSchema(
  tool: ToolDescriptor,
  aliases: Record<string, unknown>,
  fallback: Record<string, unknown>,
) {
  const properties = getSchemaProperties(tool);

  if (properties.length === 0) {
    return compact(fallback);
  }

  return compact(
    Object.fromEntries(
      properties.map((property) => [property, aliases[property]]),
    ),
  );
}

function normalizeIsoDateTime(input: string): string | null {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return trimmed;
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoFromNow(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString();
}

function dateTimeParts(isoDateTime: string, timeZone: string) {
  const date = new Date(isoDateTime);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "00";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`,
  };
}

function assertRequiredSatisfied(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
) {
  const required = getSchemaRequired(tool);
  const missing = required.filter((key) => {
    const value = args[key];

    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value === "string" && value.trim().length === 0) {
      return true;
    }

    return false;
  });

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Google Calendar MCP tool "${tool.name}" requires ${missing.join(", ")}, ` +
      `but the dispatcher did not provide them. Sent keys: ${Object.keys(args).join(", ") || "(none)"}.`,
  );
}

function normalizeGoogleResult(
  result: McpToolResult,
  successMessage: string,
  failureMessage: string,
): NormalizedToolResult {
  if (result.isError) {
    return { ok: false, message: getTextContent(result) || failureMessage };
  }

  return {
    ok: true,
    message: successMessage,
    data: result.structuredContent ?? getTextContent(result),
  };
}

function invalidDateResult(field: "start" | "end", value: string): NormalizedToolResult {
  return {
    ok: false,
    message:
      `Could not parse ${field} date/time "${value}". ` +
      "Provide an ISO 8601 datetime such as 2026-05-21T15:00:00-04:00.",
  };
}

export async function callGoogleCalendarTool(
  name: AllowedToolName,
  rawArgs: unknown,
  accessToken: string,
): Promise<NormalizedToolResult> {
  const config = getGoogleCalendarMcpConfig();

  if (name === "create_calendar_event") {
    const event = createCalendarEventSchema.parse(rawArgs);
    const timeZone = event.timeZone?.trim() || DEFAULT_TIMEZONE;
    const startDateTime = normalizeIsoDateTime(event.startDateTime);
    const endDateTime = normalizeIsoDateTime(event.endDateTime);

    if (!startDateTime) {
      return invalidDateResult("start", event.startDateTime);
    }

    if (!endDateTime) {
      return invalidDateResult("end", event.endDateTime);
    }

    const result = await callFirstAvailableAppMcpTool({
      appId: "google-calendar",
      accessToken,
      candidates: config.toolCandidates.createEvent ?? [],
      args: (tool) => {
        const start = compact({
          dateTime: startDateTime,
          timeZone,
        });
        const end = compact({
          dateTime: endDateTime,
          timeZone,
        });
        const startParts = dateTimeParts(startDateTime, timeZone);
        const endParts = dateTimeParts(endDateTime, timeZone);
        const attendees = attendeesForTool(tool, event.attendees);
        const aliases = compact({
          title: event.title,
          name: event.title,
          summary: event.title,
          calendarId: event.calendarId,
          calendar_id: event.calendarId,
          description: event.description,
          location: event.location,
          start,
          end,
          startDateTime,
          endDateTime,
          start_date_time: startDateTime,
          end_date_time: endDateTime,
          startDate: startParts.date,
          endDate: endParts.date,
          start_date: startParts.date,
          end_date: endParts.date,
          startTime: startParts.time,
          endTime: endParts.time,
          start_time: startParts.time,
          end_time: endParts.time,
          timeZone,
          timezone: timeZone,
          startTimeZone: timeZone,
          endTimeZone: timeZone,
          start_timezone: timeZone,
          end_timezone: timeZone,
          attendees,
        });
        const shaped = shapeForSchema(tool, aliases, {
          calendarId: event.calendarId,
          summary: event.title,
          description: event.description,
          location: event.location,
          start,
          end,
          startDate: startParts.date,
          startTime: startParts.time,
          endDate: endParts.date,
          endTime: endParts.time,
          attendees,
          timeZone,
        });

        assertRequiredSatisfied(tool, shaped);

        return shaped;
      },
    });

    return normalizeGoogleResult(
      result,
      "Added to Google Calendar.",
      "Google Calendar event creation failed.",
    );
  }

  const query = listCalendarEventsSchema.parse(rawArgs ?? {});
  const timeZone = query.timeZone?.trim() || DEFAULT_TIMEZONE;
  const startInput = query.startDateTime
    ? normalizeIsoDateTime(query.startDateTime)
    : null;
  const endInput = query.endDateTime
    ? normalizeIsoDateTime(query.endDateTime)
    : null;

  if (query.startDateTime && !startInput) {
    return invalidDateResult("start", query.startDateTime);
  }

  if (query.endDateTime && !endInput) {
    return invalidDateResult("end", query.endDateTime);
  }

  const startDateTime = startInput ?? isoNow();
  const endDateTime = endInput ?? isoFromNow(LIST_DEFAULT_WINDOW_DAYS);
  const startParts = dateTimeParts(startDateTime, timeZone);
  const endParts = dateTimeParts(endDateTime, timeZone);

  const result = await callFirstAvailableAppMcpTool({
    appId: "google-calendar",
    accessToken,
    candidates: config.toolCandidates.listEvents ?? [],
    args: (tool) => {
      const aliases = compact({
        calendarId: query.calendarId,
        calendar_id: query.calendarId,
        startDateTime,
        endDateTime,
        start_date_time: startDateTime,
        end_date_time: endDateTime,
        startTime: startDateTime,
        endTime: endDateTime,
        start_time: startDateTime,
        end_time: endDateTime,
        startDate: startParts.date,
        endDate: endParts.date,
        start_date: startParts.date,
        end_date: endParts.date,
        timeMin: startParts.time,
        timeMax: endParts.time,
        time_min: startParts.time,
        time_max: endParts.time,
        dateMin: startParts.date,
        dateMax: endParts.date,
        date_min: startParts.date,
        date_max: endParts.date,
        timeZone,
        timezone: timeZone,
        query: query.query,
        q: query.query,
        maxResults: query.limit,
        max_results: query.limit,
        limit: query.limit,
      });
      const shaped = shapeForSchema(tool, aliases, {
        calendarId: query.calendarId,
        dateMin: startParts.date,
        timeMin: startParts.time,
        dateMax: endParts.date,
        timeMax: endParts.time,
        q: query.query,
        maxResults: query.limit,
        timeZone,
      });

      assertRequiredSatisfied(tool, shaped);

      return shaped;
    },
  });

  return normalizeGoogleResult(
    result,
    "Calendar events loaded.",
    "Could not list Google Calendar events.",
  );
}
