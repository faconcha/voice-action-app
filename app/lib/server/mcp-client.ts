import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { getMcpAppConfig, type McpAppId } from "@/app/lib/server/mcp-apps";
import type { McpToolResult } from "@/app/lib/server/notion-mcp-client";

type McpToolDescriptor = {
  name: string;
  inputSchema?: unknown;
};

export async function withAppMcpClient<T>(
  appId: McpAppId,
  accessToken: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const app = getMcpAppConfig(appId);

  if (!app.mcpUrl) {
    throw new Error(`${app.label} MCP URL is not configured.`);
  }

  const client = new Client({
    name: "voice-action-app",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(app.mcpUrl), {
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

export async function listAppMcpTools(
  appId: McpAppId,
  accessToken: string,
): Promise<McpToolDescriptor[]> {
  return withAppMcpClient(appId, accessToken, async (client) => {
    const available = await client.listTools();

    return available.tools.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    }));
  });
}

export async function callAppMcpTool(
  appId: McpAppId,
  accessToken: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  return withAppMcpClient(appId, accessToken, async (client) => {
    const available = await client.listTools();
    const hasTool = available.tools.some((tool) => tool.name === toolName);
    const app = getMcpAppConfig(appId);

    if (!hasTool) {
      throw new Error(
        `${app.label} MCP tool "${toolName}" was not found. Available tools: ${available.tools
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

export async function callFirstAvailableAppMcpTool(params: {
  appId: McpAppId;
  accessToken: string;
  candidates: string[];
  args:
    | Record<string, unknown>
    | ((tool: McpToolDescriptor) => Record<string, unknown>);
}): Promise<McpToolResult> {
  return withAppMcpClient(params.appId, params.accessToken, async (client) => {
    const available = await client.listTools();
    const tool = available.tools.find((candidateTool) =>
      params.candidates.includes(candidateTool.name),
    );
    const app = getMcpAppConfig(params.appId);

    if (!tool) {
      throw new Error(
        `${app.label} MCP did not expose any supported tool. Tried: ${params.candidates.join(
          ", ",
        )}. Available tools: ${available.tools.map((tool) => tool.name).join(", ")}`,
      );
    }

    return (await client.callTool({
      name: tool.name,
      arguments:
        typeof params.args === "function"
          ? params.args({
              name: tool.name,
              inputSchema: tool.inputSchema,
            })
          : params.args,
    })) as McpToolResult;
  });
}
