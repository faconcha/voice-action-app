import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { getNotionMcpConfig } from "@/app/lib/server/env";
import type { RecentIdea } from "@/app/lib/shared/tools";

export type McpTextContent = {
  type: "text";
  text: string;
};

export type McpToolResult = {
  content?: Array<McpTextContent | Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

export type Destination = {
  id?: string;
  pageId?: string;
  dataSourceId?: string;
  url?: string;
  title?: string;
};

export type NotionParent =
  | { page_id: string }
  | { data_source_id: string };

export type ResolvedTarget = {
  parent?: NotionParent;
  titleProperty: string;
  pageId?: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function normalizeUuid(value: string): string {
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

export function getTextContent(result: McpToolResult): string {
  return (
    result.content
      ?.map((item) =>
        item.type === "text" && "text" in item ? item.text : JSON.stringify(item),
      )
      .filter(Boolean)
      .join("\n") || ""
  );
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

export function parseRecentIdeas(result: McpToolResult): RecentIdea[] {
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

export async function withMcpClient<T>(
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

export async function callMcpTool(
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

export async function fetchNotionEntity(
  accessToken: string,
  id: string,
): Promise<McpToolResult | null> {
  const config = getNotionMcpConfig();

  try {
    return await callMcpTool(accessToken, config.toolNames.fetch, { id });
  } catch (error) {
    console.warn(
      "[notion-mcp-client] Could not fetch Notion target schema:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function findDestination(
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

export async function resolveTarget(
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
