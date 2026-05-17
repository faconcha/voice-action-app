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

type Destination = {
  id?: string;
  pageId?: string;
  dataSourceId?: string;
  url?: string;
  title?: string;
};

type NotionParent =
  | { page_id: string }
  | { data_source_id: string };

type ResolvedTarget = {
  parent?: NotionParent;
  titleProperty: string;
  pageId?: string;
};

type CreateNote = ReturnType<typeof createNotionPageSchema.parse>;
type AppendNote = ReturnType<typeof appendNoteSchema.parse>;
type ParsedNote = CreateNote | AppendNote;

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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeUuid(value: string): string {
  const trimmed = value.trim();
  const compact = trimmed.replace(/-/g, "");

  if (!/^[0-9a-f]{32}$/i.test(compact)) {
    return trimmed;
  }

  return compact
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
    .toLowerCase();
}

function extractIdFromUrl(url: string): string | undefined {
  const clean = url.split("?")[0] ?? url;
  const match = clean.match(/([0-9a-f]{32})(?:$|[^0-9a-f])/i);

  if (!match?.[1]) {
    return undefined;
  }

  return normalizeUuid(match[1]);
}

function extractDataSourceId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const collectionMatch = value.match(/collection:\/\/([0-9a-f-]{32,36})/i);
  const dataSourceMatch = value.match(
    /["']?(?:data_source_id|dataSourceId)["']?\s*[:=]\s*["']([0-9a-f-]{32,36})["']/i,
  );
  const match = collectionMatch?.[1] ?? dataSourceMatch?.[1];

  return match ? normalizeUuid(match) : undefined;
}

function getToolText(result: McpToolResult | null | undefined): string {
  if (!result) {
    return "";
  }

  const text = getTextContent(result);

  if (text) {
    return text;
  }

  if (result.structuredContent) {
    return JSON.stringify(result.structuredContent);
  }

  return JSON.stringify(result);
}

function extractTitlePropertyFromStructured(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const titleProperty = extractTitlePropertyFromStructured(item);

      if (titleProperty) {
        return titleProperty;
      }
    }

    return undefined;
  }

  const record = toRecord(value);

  if (!record) {
    return undefined;
  }

  const properties = toRecord(record.properties);

  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      const propertyRecord = toRecord(property);

      if (
        propertyRecord?.type === "title" ||
        propertyRecord?.id === "title"
      ) {
        return name;
      }
    }
  }

  for (const nested of Object.values(record)) {
    const titleProperty = extractTitlePropertyFromStructured(nested);

    if (titleProperty) {
      return titleProperty;
    }
  }

  return undefined;
}

function extractTitlePropertyFromFetch(result: McpToolResult | null | undefined) {
  const structuredTitle = extractTitlePropertyFromStructured(
    result?.structuredContent,
  );

  if (structuredTitle) {
    return structuredTitle;
  }

  const text = getToolText(result);
  const match =
    text.match(/"([^"]+)"\s+TITLE\b/i) ??
    text.match(/`([^`]+)`\s+TITLE\b/i) ??
    text.match(/\b([A-Za-z][A-Za-z0-9 _-]{0,80})\s+TITLE\b/i);

  return match?.[1]?.trim();
}

function extractFirstDataSourceIdFromFetch(
  result: McpToolResult | null | undefined,
) {
  return extractDataSourceId(getToolText(result));
}

function extractDestinationsFromStructured(value: unknown): Destination[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractDestinationsFromStructured);
  }

  const record = toRecord(value);

  if (!record) {
    return [];
  }

  const candidates = [
    record,
    record.page,
    record.result,
    record.resource,
    record.database,
    record.data_source,
    record.dataSource,
    record.object,
  ]
    .map(toRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));

  const nested = [
    record.results,
    record.items,
    record.pages,
    record.data,
    record.databases,
    record.data_sources,
    record.dataSources,
  ].flatMap(extractDestinationsFromStructured);

  const direct = candidates
    .map<Destination | null>((item) => {
      const url = typeof item.url === "string" ? item.url : undefined;
      const objectType =
        typeof item.object === "string"
          ? item.object
          : typeof item.type === "string"
            ? item.type
            : undefined;
      const rawId =
        typeof item.id === "string"
          ? item.id
          : typeof item.pageId === "string"
            ? item.pageId
            : url
              ? extractIdFromUrl(url)
              : undefined;
      const id = rawId ? normalizeUuid(rawId) : undefined;
      const dataSourceId =
        (typeof item.data_source_id === "string"
          ? normalizeUuid(item.data_source_id)
          : typeof item.dataSourceId === "string"
            ? normalizeUuid(item.dataSourceId)
            : undefined) ??
        extractDataSourceId(url) ??
        extractDataSourceId(id) ??
        (objectType?.includes("data_source") || objectType === "database"
          ? id
          : undefined);
      const title =
        typeof item.title === "string"
          ? item.title
          : typeof item.name === "string"
            ? item.name
            : undefined;

      return id || dataSourceId || url
        ? {
            id,
            pageId: dataSourceId ? undefined : id,
            dataSourceId,
            url,
            title,
          }
        : null;
    })
    .filter((item): item is Destination => item !== null);

  return [...direct, ...nested];
}

function extractDestinations(result: McpToolResult): Destination[] {
  const structured = result.structuredContent;
  const fromStructured = extractDestinationsFromStructured(structured);

  if (fromStructured.length > 0) {
    return fromStructured;
  }

  const text = getTextContent(result);

  try {
    return extractDestinationsFromStructured(JSON.parse(text) as unknown);
  } catch {
    const urls = text.match(/https:\/\/(?:www\.)?notion\.so\/[^\s)]+/gi) ?? [];
    const urlDestinations = urls.map<Destination>((url) => ({
      url,
      id: extractIdFromUrl(url),
      pageId: extractIdFromUrl(url),
    }));
    const collectionDestinations = Array.from(
      text.matchAll(/collection:\/\/([0-9a-f-]{32,36})/gi),
    ).map<Destination>((match) => ({
      id: normalizeUuid(match[1]),
      dataSourceId: normalizeUuid(match[1]),
    }));

    return [...collectionDestinations, ...urlDestinations];
  }
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

  return [
    hasUsefulDescription ? description : "",
    shouldKeepRawText(note, description) ? note.rawText?.trim() : "",
  ]
    .filter((part) => part !== "")
    .join("\n\n");
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

function shouldKeepRawText(
  note: { rawText?: string; title?: string; summary?: string },
  description?: string,
) {
  const raw = note.rawText?.trim();

  if (!raw) {
    return false;
  }

  if (!description) {
    return false;
  }

  return raw !== description && raw !== note.title?.trim();
}

function titleFromText(text: string) {
  const clean = text.trim().replace(/\s+/g, " ");

  if (!clean) {
    return "Untitled note";
  }

  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
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

async function fetchNotionEntity(
  accessToken: string,
  id: string,
): Promise<McpToolResult | null> {
  const config = getNotionMcpConfig();

  try {
    return await callMcpTool(accessToken, config.toolNames.fetch, { id });
  } catch (error) {
    console.warn(
      "[notion-mcp] Could not fetch Notion target schema:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function findDestination(
  accessToken: string,
  destinationHint?: string,
): Promise<Destination | null> {
  const config = getNotionMcpConfig();
  const query = destinationHint?.trim() || "Sandbox de ideas";
  const result = await callMcpTool(accessToken, config.toolNames.listRecent, {
    query,
    limit: 5,
  });

  if (result.isError) {
    return null;
  }

  const destinations = extractDestinations(result);
  const normalizedQuery = query.toLowerCase();

  return (
    destinations.find((destination) =>
      destination.title?.toLowerCase().includes(normalizedQuery),
    ) ??
    destinations.find((destination) => Boolean(destination.dataSourceId)) ??
    destinations.find((destination) => Boolean(destination.pageId)) ??
    null
  );
}

async function resolveTarget(
  accessToken: string,
  destinationHint?: string,
): Promise<ResolvedTarget> {
  const config = getNotionMcpConfig();

  if (config.parentPageId) {
    const pageId = normalizeUuid(config.parentPageId);

    return {
      parent: { page_id: pageId },
      titleProperty: "title",
      pageId,
    };
  }

  const destination = await findDestination(accessToken, destinationHint);

  if (!destination) {
    return { titleProperty: "title" };
  }

  if (destination.dataSourceId) {
    const dataSource = await fetchNotionEntity(
      accessToken,
      `collection://${destination.dataSourceId}`,
    );

    return {
      parent: { data_source_id: destination.dataSourceId },
      titleProperty: extractTitlePropertyFromFetch(dataSource) ?? "Name",
    };
  }

  const destinationId = destination.id ?? destination.pageId;
  const fetched = destinationId
    ? await fetchNotionEntity(accessToken, destinationId)
    : null;
  const fetchedDataSourceId = extractFirstDataSourceIdFromFetch(fetched);

  if (fetchedDataSourceId) {
    const dataSource = await fetchNotionEntity(
      accessToken,
      `collection://${fetchedDataSourceId}`,
    );

    return {
      parent: { data_source_id: fetchedDataSourceId },
      titleProperty:
        extractTitlePropertyFromFetch(dataSource) ??
        extractTitlePropertyFromFetch(fetched) ??
        "Name",
    };
  }

  const fetchedTitleProperty = extractTitlePropertyFromFetch(fetched);

  if (destinationId && fetchedTitleProperty) {
    return {
      parent: { data_source_id: destinationId },
      titleProperty: fetchedTitleProperty,
    };
  }

  if (destination.pageId) {
    return {
      parent: { page_id: destination.pageId },
      titleProperty: "title",
      pageId: destination.pageId,
    };
  }

  return { titleProperty: "title" };
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
    const appendPayload = await buildAppendPayload(token, note);
    const result = await callMcpTool(
      token,
      appendPayload ? config.toolNames.appendNote : config.toolNames.createPage,
      appendPayload ?? (await buildStructuredPagePayload(token, note)),
    );

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
