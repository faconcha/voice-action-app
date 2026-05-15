import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  appendNoteSchema,
  createNotionPageSchema,
  listRecentIdeasSchema,
  type AllowedToolName,
  type RecentIdea,
} from "@/app/lib/shared/tools";
import { getNotionMcpConfig } from "@/app/lib/server/env";

type McpTextContent = {
  type: "text";
  text: string;
};

type McpToolResult = {
  content?: Array<McpTextContent | Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

type NormalizedToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
  recentItems?: RecentIdea[];
};

function getTextContent(result: McpToolResult): string {
  return (
    result.content
      ?.map((item) =>
        item.type === "text" && "text" in item ? item.text : JSON.stringify(item),
      )
      .filter(Boolean)
      .join("\n") || ""
  );
}

function asRecentIdeas(value: unknown): RecentIdea[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map<RecentIdea | null>((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const title = String(record.title ?? record.name ?? `Idea ${index + 1}`);

      return {
        id: String(record.id ?? record.pageId ?? title),
        title,
        summary:
          typeof record.summary === "string" ? record.summary : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
        tags: Array.isArray(record.tags)
          ? record.tags.map(String).slice(0, 12)
          : undefined,
        priority:
          record.priority === "low" ||
          record.priority === "medium" ||
          record.priority === "high"
            ? record.priority
            : undefined,
        createdAt:
          typeof record.createdAt === "string"
            ? record.createdAt
            : typeof record.created_time === "string"
              ? record.created_time
              : undefined,
      };
    })
    .filter((item): item is RecentIdea => Boolean(item));
}

function parseRecentIdeas(result: McpToolResult): RecentIdea[] {
  const structured = result.structuredContent;

  if (Array.isArray(structured)) {
    return asRecentIdeas(structured);
  }

  if (structured && typeof structured === "object") {
    const record = structured as Record<string, unknown>;
    return asRecentIdeas(record.items ?? record.results ?? record.pages);
  }

  const text = getTextContent(result);

  try {
    const parsed = JSON.parse(text) as unknown;
    return parseRecentIdeas({ structuredContent: parsed });
  } catch {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((title, index) => ({
        id: `${index}-${title}`,
        title,
      }));
  }
}

function noteToMarkdown(note: {
  title: string;
  summary: string;
  tags: string[];
  nextAction: string;
  priority: string;
  sourceTranscript?: string;
}) {
  return [
    `# ${note.title}`,
    "",
    `## Summary`,
    note.summary,
    "",
    `## Tags`,
    note.tags.length ? note.tags.map((tag) => `- ${tag}`).join("\n") : "- untagged",
    "",
    `## Next action`,
    note.nextAction,
    "",
    `## Priority`,
    note.priority,
    note.sourceTranscript
      ? ["", "## Source transcript", note.sourceTranscript].join("\n")
      : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

async function withMcpClient<T>(
  accessToken: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const config = getNotionMcpConfig();
  const client = new Client({
    name: "voice-action-app",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "VoiceActionApp-MCP-Client/0.1",
      },
    },
  });

  await client.connect(transport);

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function callMcpTool(
  accessToken: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  return withMcpClient(accessToken, async (client) => {
    const available = await client.listTools();
    const hasTool = available.tools.some((tool) => tool.name === toolName);

    if (!hasTool) {
      throw new Error(
        `Notion MCP tool "${toolName}" was not found. Set the matching NOTION_MCP_*_TOOL env var to one of: ${available.tools
          .map((tool) => tool.name)
          .join(", ")}`,
      );
    }

    return (await client.callTool({
      name: toolName,
      arguments: args,
    })) as McpToolResult;
  });
}

function buildStructuredPagePayload(
  note: ReturnType<typeof createNotionPageSchema.parse>,
) {
  const config = getNotionMcpConfig();
  const content = noteToMarkdown(note);

  return {
    parent: config.parentPageId ? { page_id: config.parentPageId } : undefined,
    parentPageId: config.parentPageId,
    parent_page_id: config.parentPageId,
    pages: [
      {
        properties: {
          title: note.title,
        },
        content,
        icon: "🎙️",
      },
    ],
    title: note.title,
    summary: note.summary,
    tags: note.tags,
    nextAction: note.nextAction,
    next_action: note.nextAction,
    priority: note.priority,
    sourceTranscript: note.sourceTranscript,
    source_transcript: note.sourceTranscript,
    content,
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
    const result = await callMcpTool(
      token,
      config.toolNames.createPage,
      buildStructuredPagePayload(note),
    );

    if (result.isError) {
      return { ok: false, message: getTextContent(result) || "Notion save failed." };
    }

    return {
      ok: true,
      message: "Saved to Notion.",
      data: result.structuredContent ?? getTextContent(result),
    };
  }

  if (name === "append_note") {
    const note = appendNoteSchema.parse(rawArgs);
    const targetPageId = note.pageId ?? config.parentPageId;

    if (!targetPageId) {
      throw new Error(
        "append_note requires pageId or NOTION_PARENT_PAGE_ID to be configured.",
      );
    }

    const result = await callMcpTool(token, config.toolNames.appendNote, {
      ...buildStructuredPagePayload(note),
      pageId: targetPageId,
      page_id: targetPageId,
      command: "insert_content_after",
      selection_with_ellipsis: "...",
      new_str: noteToMarkdown(note),
    });

    if (result.isError) {
      return { ok: false, message: getTextContent(result) || "Notion append failed." };
    }

    return {
      ok: true,
      message: "Saved to Notion.",
      data: result.structuredContent ?? getTextContent(result),
    };
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
