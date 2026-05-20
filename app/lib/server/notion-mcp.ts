import {
  appendNoteSchema,
  createNotionPageSchema,
  listRecentIdeasSchema,
  type AllowedToolName,
  type RecentIdea,
} from "@/app/lib/shared/tools";
import { getNotionMcpConfig } from "@/app/lib/server/env";
import {
  callMcpTool,
  getTextContent,
  normalizeUuid,
  parseRecentIdeas,
  resolveTarget,
  type McpToolResult,
} from "@/app/lib/server/notion-mcp-client";

type NormalizedToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
  recentItems?: RecentIdea[];
};

type CreateNote = ReturnType<typeof createNotionPageSchema.parse>;
type AppendNote = ReturnType<typeof appendNoteSchema.parse>;
type ParsedNote = CreateNote | AppendNote;

function noteToMarkdown(note: {
  rawText?: string;
  title?: string;
  summary?: string;
  tags: string[];
  nextAction: string;
  priority: string;
  sourceTranscript?: string;
}) {
  const original = note.rawText ?? note.sourceTranscript ?? note.summary ?? note.title ?? "Untitled note";
  const description = note.summary?.trim();
  const title = note.title?.trim();
  const hasUsefulDescription =
    description &&
    description !== title &&
    description !== original.trim() &&
    description.length > 8;

  if (hasUsefulDescription) {
    return description;
  }

  const cleanOriginal = original.trim();

  return cleanOriginal !== title ? cleanOriginal : "";
}

function noteToAppendMarkdown(note: {
  rawText?: string;
  title?: string;
  summary?: string;
  sourceTranscript?: string;
}) {
  const original = note.rawText ?? note.sourceTranscript ?? note.summary ?? note.title ?? "Nota";
  const body = note.summary?.trim() || original.trim();

  return [
    "> " + (note.title ? `**${note.title.trim()}**` : "**Nota rápida**"),
    body ? `> ${body}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function titleFromText(text: string) {
  const clean = text.trim().replace(/\s+/g, " ");

  if (!clean) {
    return "Untitled note";
  }

  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
}

async function buildStructuredPagePayload(
  accessToken: string,
  note: ParsedNote,
) {
  const content = noteToMarkdown(note);
  const original =
    note.rawText ??
    note.sourceTranscript ??
    note.summary ??
    note.title ??
    "Untitled note";
  const target = await resolveTarget(accessToken, note.destinationHint);
  const title = note.title?.trim() || titleFromText(original);
  const page = {
    properties: {
      [target.titleProperty]: title,
    },
    ...(content ? { content } : {}),
  };

  return {
    ...(target.parent ? { parent: target.parent } : {}),
    pages: [page],
  };
}

async function buildAppendPayload(
  accessToken: string,
  note: ParsedNote,
) {
  const config = getNotionMcpConfig();
  const explicitPageId = "pageId" in note ? note.pageId : undefined;
  const target = explicitPageId
    ? null
    : await resolveTarget(accessToken, note.destinationHint);
  const pageId =
    explicitPageId ??
    target?.pageId ??
    (config.parentPageId ? normalizeUuid(config.parentPageId) : undefined);

  if (!pageId) {
    return null;
  }

  return {
    page_id: pageId,
    pageId,
    command: "insert_content_after",
    selection_with_ellipsis: "...",
    new_str: noteToAppendMarkdown(note),
  };
}

function toCreateOrAppendResult(
  result: McpToolResult,
  failureMessage: string,
): NormalizedToolResult {
  if (result.isError) {
    return { ok: false, message: getTextContent(result) || failureMessage };
  }

  return {
    ok: true,
    message: "Saved to Notion.",
    data: result.structuredContent ?? getTextContent(result),
  };
}

export async function callVoiceInboxTool(
  name: AllowedToolName,
  rawArgs: unknown,
  accessToken?: string,
): Promise<NormalizedToolResult> {
  const config = getNotionMcpConfig();
  const token = accessToken ?? config.accessToken;

  if (!token) {
    throw new Error("Connect Notion before saving notes.");
  }

  if (name === "create_notion_page") {
    const note = createNotionPageSchema.parse(rawArgs);
    const appendPayload = note.appendToExisting
      ? await buildAppendPayload(token, note)
      : null;
    const result = await callMcpTool(
      token,
      appendPayload ? config.toolNames.appendNote : config.toolNames.createPage,
      appendPayload ?? (await buildStructuredPagePayload(token, note)),
    );

    return toCreateOrAppendResult(result, "Notion save failed.");
  }

  if (name === "append_note") {
    const note = appendNoteSchema.parse(rawArgs);
    const appendPayload = await buildAppendPayload(token, note);
    const result = await callMcpTool(
      token,
      appendPayload ? config.toolNames.appendNote : config.toolNames.createPage,
      appendPayload ?? (await buildStructuredPagePayload(token, note)),
    );

    return toCreateOrAppendResult(result, "Notion append failed.");
  }

  const { limit } = listRecentIdeasSchema.parse(rawArgs ?? {});
  const result = await callMcpTool(token, config.toolNames.listRecent, {
    query: "Voice Action App ideas product content experiments strategy insights",
    limit,
  });
  const recentItems = parseRecentIdeas(result).slice(0, limit);

  return {
    ok: !result.isError,
    message: result.isError
      ? getTextContent(result) || "Could not list recent ideas."
      : "Recent ideas loaded.",
    data: result.structuredContent ?? getTextContent(result),
    recentItems,
  };
}
