import { NextRequest, NextResponse } from "next/server";

import { getMcpAppConfig } from "@/app/lib/server/mcp-apps";
import {
  discoverMcpOAuthMetadata,
  generatePkce,
  getBaseUrl,
  parseMcpAppId,
  registerMcpOAuthClient,
  setMcpOAuthState,
} from "@/app/lib/server/mcp-oauth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ app: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { app: rawAppId } = await context.params;

  try {
    const appId = parseMcpAppId(rawAppId);
    const app = getMcpAppConfig(appId);
    const redirectUri = `${getBaseUrl(request)}/api/mcp/apps/${appId}/callback`;
    const metadata = await discoverMcpOAuthMetadata(appId);
    const client = await registerMcpOAuthClient(appId, metadata, redirectUri);
    const { codeVerifier, codeChallenge } = generatePkce();
    const state = crypto.randomUUID();
    const authorizationUrl = new URL(metadata.authorization_endpoint);

    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", client.client_id);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("prompt", "consent");

    if (app.scope) {
      authorizationUrl.searchParams.set("scope", app.scope);
    }

    const response = NextResponse.redirect(authorizationUrl);
    setMcpOAuthState(response, appId, {
      appId,
      state,
      codeVerifier,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      redirectUri,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not start MCP OAuth.",
      },
      { status: 500 },
    );
  }
}
