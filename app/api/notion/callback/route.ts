import { NextRequest, NextResponse } from "next/server";

import {
  clearOAuthState,
  exchangeCodeForTokens,
  getBaseUrl,
  readOAuthState,
  setNotionSession,
  tokenResponseToSession,
} from "@/app/lib/server/notion-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const appUrl = getBaseUrl(request);

  try {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (error) {
      throw new Error(url.searchParams.get("error_description") ?? error);
    }

    if (!code || !state) {
      throw new Error("Missing Notion OAuth callback code or state.");
    }

    const stored = readOAuthState(request);

    if (stored.state !== state) {
      throw new Error("Invalid Notion OAuth state.");
    }

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: stored.codeVerifier,
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      redirectUri: stored.redirectUri,
    });
    const response = NextResponse.redirect(`${appUrl}/?notion=connected`);

    clearOAuthState(response);
    setNotionSession(
      response,
      tokenResponseToSession(tokens, stored.clientId, stored.clientSecret),
    );

    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      `${appUrl}/?notion=error&message=${encodeURIComponent(
        error instanceof Error ? error.message : "Could not connect Notion.",
      )}`,
    );
    clearOAuthState(response);
    return response;
  }
}
