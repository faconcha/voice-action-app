import { NextRequest, NextResponse } from "next/server";

import { getMcpAppConfig } from "@/app/lib/server/mcp-apps";
import {
  clearMcpOAuthState,
  exchangeCodeForMcpTokens,
  getBaseUrl,
  parseMcpAppId,
  readMcpOAuthState,
  setMcpSession,
  tokenResponseToMcpSession,
} from "@/app/lib/server/mcp-oauth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ app: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { app: rawAppId } = await context.params;
  const appUrl = getBaseUrl(request);
  let appId = parseMcpAppId(rawAppId);

  try {
    const app = getMcpAppConfig(appId);
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (error) {
      throw new Error(url.searchParams.get("error_description") ?? error);
    }

    if (!code || !state) {
      throw new Error(`Missing ${app.label} OAuth callback code or state.`);
    }

    const stored = readMcpOAuthState(request, appId);

    if (stored.state !== state) {
      throw new Error(`Invalid ${app.label} OAuth state.`);
    }

    appId = stored.appId;

    const tokens = await exchangeCodeForMcpTokens({
      appId,
      code,
      codeVerifier: stored.codeVerifier,
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      redirectUri: stored.redirectUri,
    });
    const response = NextResponse.redirect(`${appUrl}/?mcp=${appId}:connected`);

    clearMcpOAuthState(response, appId);
    setMcpSession(
      response,
      appId,
      tokenResponseToMcpSession(
        appId,
        tokens,
        stored.clientId,
        stored.clientSecret,
      ),
    );

    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      `${appUrl}/?mcp=${appId}:error&message=${encodeURIComponent(
        error instanceof Error ? error.message : "Could not connect MCP app.",
      )}`,
    );
    clearMcpOAuthState(response, appId);
    return response;
  }
}
