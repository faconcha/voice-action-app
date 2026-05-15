import { z } from "zod";

export const allowedToolNames = [
  "create_notion_page",
  "append_note",
  "list_recent_ideas",
] as const;

export type AllowedToolName = (typeof allowedToolNames)[number];

export const prioritySchema = z.enum(["low", "medium", "high"]);

export const structuredNoteSchema = z.object({
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(48)).max(12).default([]),
  nextAction: z.string().min(1).max(500),
  priority: prioritySchema,
  sourceTranscript: z.string().max(8000).optional(),
});

export const createNotionPageSchema = structuredNoteSchema;

export const appendNoteSchema = structuredNoteSchema.extend({
  pageId: z.string().min(1).optional(),
});

export const listRecentIdeasSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
});

export type StructuredNote = z.infer<typeof structuredNoteSchema>;

export type RecentIdea = {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  tags?: string[];
  priority?: z.infer<typeof prioritySchema>;
  createdAt?: string;
};

export const realtimeTools = [
  {
    type: "function",
    name: "create_notion_page",
    description:
      "Save a sufficiently clear idea, todo, insight, experiment, or content concept as a structured Notion page.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "Short clear title." },
        summary: {
          type: "string",
          description: "Concise cleaned-up note, not a transcript.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Useful tags such as product, content, experiment, workflow.",
        },
        nextAction: {
          type: "string",
          description: "One concrete next action. Use 'Review later' if unclear.",
        },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        sourceTranscript: {
          type: "string",
          description: "Optional relevant user wording.",
        },
      },
      required: ["title", "summary", "tags", "nextAction", "priority"],
    },
  },
  {
    type: "function",
    name: "append_note",
    description:
      "Append a structured follow-up note to the active Notion capture page or a specified page.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        pageId: {
          type: "string",
          description: "Optional Notion page id to append to.",
        },
        title: { type: "string" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        nextAction: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        sourceTranscript: { type: "string" },
      },
      required: ["title", "summary", "tags", "nextAction", "priority"],
    },
  },
  {
    type: "function",
    name: "list_recent_ideas",
    description: "List recently saved Voice Action App ideas from Notion.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          minimum: 1,
          maximum: 20,
          description: "Maximum number of recent ideas to return.",
        },
      },
      required: [],
    },
  },
] as const;

export function isAllowedToolName(name: string): name is AllowedToolName {
  return allowedToolNames.includes(name as AllowedToolName);
}
