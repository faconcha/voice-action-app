import { NextRequest, NextResponse } from "next/server";

import {
  discoverNotionOAuthMetadata,
  generatePkce,
  getBaseUrl,
  registerNotionOAuthClient,
  setOAuthState,
} from "@/app/lib/server/notion-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const redirectUri = `${getBaseUrl(request)}/api/notion/callback`;
    const metadata = await discoverNotionOAuthMetadata();
    const client = await registerNotionOAuthClient(metadata, redirectUri);
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

    const response = NextResponse.redirect(authorizationUrl);
    setOAuthState(response, {
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
            : "Could not start Notion OAuth.",
      },
      { status: 500 },
    );
  }
}
