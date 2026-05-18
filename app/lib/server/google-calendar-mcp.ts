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
    return fallback;
  }

  return compact(
    Object.fromEntries(
      properties.map((property) => [property, aliases[property]]),
    ),
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

export async function callGoogleCalendarTool(
  name: AllowedToolName,
  rawArgs: unknown,
  accessToken: string,
): Promise<NormalizedToolResult> {
  const config = getGoogleCalendarMcpConfig();

  if (name === "create_calendar_event") {
    const event = createCalendarEventSchema.parse(rawArgs);
    const result = await callFirstAvailableAppMcpTool({
      appId: "google-calendar",
      accessToken,
      candidates: config.toolCandidates.createEvent ?? [],
      args: (tool) => {
        const start = compact({
          dateTime: event.startDateTime,
          timeZone: event.timeZone,
        });
        const end = compact({
          dateTime: event.endDateTime,
          timeZone: event.timeZone,
        });
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
          startDateTime: event.startDateTime,
          endDateTime: event.endDateTime,
          start_date_time: event.startDateTime,
          end_date_time: event.endDateTime,
          startTime: event.startDateTime,
          endTime: event.endDateTime,
          start_time: event.startDateTime,
          end_time: event.endDateTime,
          startDate: event.startDateTime,
          endDate: event.endDateTime,
          start_date: event.startDateTime,
          end_date: event.endDateTime,
          timeZone: event.timeZone,
          timezone: event.timeZone,
          attendees,
        });

        return shapeForSchema(tool, aliases, {
          calendarId: event.calendarId,
          summary: event.title,
          description: event.description,
          location: event.location,
          start,
          end,
          attendees,
        });
      },
    });

    return normalizeGoogleResult(
      result,
      "Added to Google Calendar.",
      "Google Calendar event creation failed.",
    );
  }

  const query = listCalendarEventsSchema.parse(rawArgs ?? {});
  const result = await callFirstAvailableAppMcpTool({
    appId: "google-calendar",
    accessToken,
    candidates: config.toolCandidates.listEvents ?? [],
    args: (tool) => {
      const aliases = compact({
        calendarId: query.calendarId,
        calendar_id: query.calendarId,
        startDateTime: query.startDateTime,
        endDateTime: query.endDateTime,
        start_date_time: query.startDateTime,
        end_date_time: query.endDateTime,
        startTime: query.startDateTime,
        endTime: query.endDateTime,
        start_time: query.startDateTime,
        end_time: query.endDateTime,
        startDate: query.startDateTime,
        endDate: query.endDateTime,
        start_date: query.startDateTime,
        end_date: query.endDateTime,
        timeMin: query.startDateTime,
        timeMax: query.endDateTime,
        time_min: query.startDateTime,
        time_max: query.endDateTime,
        dateMin: query.startDateTime,
        dateMax: query.endDateTime,
        date_min: query.startDateTime,
        date_max: query.endDateTime,
        timeZone: query.timeZone,
        timezone: query.timeZone,
        query: query.query,
        q: query.query,
        maxResults: query.limit,
        max_results: query.limit,
        limit: query.limit,
      });

      return shapeForSchema(tool, aliases, {
        calendarId: query.calendarId,
        timeMin: query.startDateTime,
        timeMax: query.endDateTime,
        q: query.query,
        maxResults: query.limit,
      });
    },
  });

  return normalizeGoogleResult(
    result,
    "Calendar events loaded.",
    "Could not list Google Calendar events.",
  );
}
