import { z } from "zod";

export const allowedToolNames = [
  "create_notion_page",
  "append_note",
  "list_recent_ideas",
  "create_calendar_event",
  "list_calendar_events",
] as const;

export type AllowedToolName = (typeof allowedToolNames)[number];

export const prioritySchema = z.enum(["low", "medium", "high"]);

export const structuredNoteSchema = z.object({
  rawText: z.string().min(1).max(8000).optional(),
  destinationHint: z.string().min(1).max(200).optional(),
  appendToExisting: z.boolean().default(false),
  title: z.string().min(1).max(140).optional(),
  summary: z.string().min(1).max(4000).optional(),
  tags: z.array(z.string().min(1).max(48)).max(12).default([]),
  nextAction: z.string().min(1).max(500).default("Review later"),
  priority: prioritySchema.default("medium"),
  sourceTranscript: z.string().max(8000).optional(),
});

export const createNotionPageSchema = structuredNoteSchema;

export const appendNoteSchema = structuredNoteSchema.extend({
  pageId: z.string().min(1).optional(),
});

export const listRecentIdeasSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
});

export const createCalendarEventSchema = z.object({
  title: z.string().min(1).max(200),
  startDateTime: z.string().min(1).max(80),
  endDateTime: z.string().min(1).max(80),
  timeZone: z.string().min(1).max(80).optional(),
  calendarId: z.string().min(1).max(200).default("primary"),
  description: z.string().max(4000).optional(),
  location: z.string().max(500).optional(),
  attendees: z.array(z.string().email()).max(20).default([]),
});

export const listCalendarEventsSchema = z.object({
  startDateTime: z.string().min(1).max(80).optional(),
  endDateTime: z.string().min(1).max(80).optional(),
  timeZone: z.string().min(1).max(80).optional(),
  calendarId: z.string().min(1).max(200).default("primary"),
  query: z.string().max(300).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export type StructuredNote = z.infer<typeof structuredNoteSchema>;
export type CreateCalendarEvent = z.infer<typeof createCalendarEventSchema>;
export type ListCalendarEvents = z.infer<typeof listCalendarEventsSchema>;

export type RecentIdea = {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  tags?: string[];
  priority?: z.infer<typeof prioritySchema>;
  createdAt?: string;
};

export function isAllowedToolName(name: string): name is AllowedToolName {
  return allowedToolNames.includes(name as AllowedToolName);
}
