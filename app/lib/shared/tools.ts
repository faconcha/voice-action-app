import { z } from "zod";

export const allowedToolNames = [
  "create_notion_page",
  "append_note",
  "list_recent_ideas",
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
      "Save the current spoken note to Notion immediately. Use this whenever the user asks to save/capture/remember something, even if the content is simple, rough, or obviously false.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        rawText: {
          type: "string",
          description: "The user's exact note or the closest transcript of what should be saved.",
        },
        destinationHint: {
          type: "string",
          description:
            "Optional target mentioned by the user, such as Sandbox de ideas, a database, or a page name. Use Sandbox de ideas by default.",
        },
        appendToExisting: {
          type: "boolean",
          description:
            "Set true only when the user explicitly says to add/update/append to an existing page/database item, or the conversation clearly refers to an existing experiment/page.",
        },
        title: { type: "string", description: "Useful Notion page title." },
        summary: {
          type: "string",
          description:
            "Only include a description when the conversation contains enough information. For tiny notes, omit or keep it very short.",
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
      required: ["rawText", "title", "tags", "nextAction", "priority"],
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
        rawText: { type: "string" },
        destinationHint: { type: "string" },
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
