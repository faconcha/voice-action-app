import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

import {
  getMcpAppConfig,
  isMcpAppId,
  type McpAppConfig,
  type McpAppId,
} from "@/app/lib/server/mcp-apps";

type OAuthMetadata = {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

type ClientCredentials = {
  client_id: string;
  client_secret?: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export type McpSession = {
  appId: McpAppId;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  clientSecret?: string;
};

type OAuthState = {
  appId: McpAppId;
  state: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
};

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function getCookieKey() {
  const secret = process.env.MCP_COOKIE_SECRET ?? process.env.NOTION_COOKIE_SECRET;

  if (!secret) {
    throw new Error(
      "Missing MCP_COOKIE_SECRET. Generate one with `openssl rand -base64 32`.",
    );
  }

  return createHash("sha256").update(secret).digest();
}

function encryptJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getCookieKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [base64Url(iv), base64Url(tag), base64Url(encrypted)].join(".");
}

function decryptJson<T>(value: string): T {
  const [ivPart, tagPart, encryptedPart] = value.split(".");

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Invalid encrypted cookie.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getCookieKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8")) as T;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function getStateCookieName(app: McpAppConfig) {
  return `voice_action_${app.cookieKey}_oauth`;
}

function getSessionCookieName(app: McpAppConfig) {
  return `voice_action_${app.cookieKey}_session`;
}

function getPublicAppUrl(redirectUri: string) {
  return new URL(redirectUri).origin;
}

export function getBaseUrl(request: NextRequest | Request) {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";

  if (!host) {
    throw new Error("Could not determine request host.");
  }

  return `${proto}://${host}`;
}

export function parseMcpAppId(rawAppId: string): McpAppId {
  if (!isMcpAppId(rawAppId)) {
    throw new Error(`Unsupported MCP app: ${rawAppId}`);
  }

  return rawAppId;
}

export async function discoverMcpOAuthMetadata(
  appId: McpAppId,
): Promise<OAuthMetadata> {
  const app = getMcpAppConfig(appId);

  if (!app.authServer) {
    throw new Error(
      `${app.label} MCP OAuth is not configured. Set ${app.id === "google-calendar" ? "GOOGLE_CALENDAR_MCP_URL or GOOGLE_CALENDAR_MCP_AUTH_SERVER" : "NOTION_MCP_URL"}.`,
    );
  }

  const response = await fetch(
    new URL("/.well-known/oauth-authorization-server", app.authServer),
    {
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not discover ${app.label} OAuth metadata: ${response.status}`,
    );
  }

  const metadata = (await response.json()) as OAuthMetadata;

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(`${app.label} OAuth metadata is missing required endpoints.`);
  }

  return metadata;
}

export async function registerMcpOAuthClient(
  appId: McpAppId,
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<ClientCredentials> {
  const app = getMcpAppConfig(appId);

  if (!metadata.registration_endpoint) {
    if (app.clientId) {
      return {
        client_id: app.clientId,
        client_secret: app.clientSecret,
      };
    }

    throw new Error(
      `${app.label} MCP OAuth metadata did not include a registration endpoint. Set ${app.id === "google-calendar" ? "GOOGLE_CALENDAR_MCP_CLIENT_ID" : "NOTION_MCP_CLIENT_ID"} for static client credentials.`,
    );
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "Voice Action App",
      client_uri: getPublicAppUrl(redirectUri),
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `${app.label} client registration failed: ${await response.text()}`,
    );
  }

  return (await response.json()) as ClientCredentials;
}

export function generatePkce() {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );

  return { codeVerifier, codeChallenge };
}

export function setMcpOAuthState(
  response: NextResponse,
  appId: McpAppId,
  state: OAuthState,
) {
  response.cookies.set(
    getStateCookieName(getMcpAppConfig(appId)),
    encryptJson(state),
    cookieOptions(10 * 60),
  );
}

export function readMcpOAuthState(
  request: NextRequest,
  appId: McpAppId,
): OAuthState {
  const app = getMcpAppConfig(appId);
  const value = request.cookies.get(getStateCookieName(app))?.value;

  if (!value) {
    throw new Error(`Missing ${app.label} OAuth state. Start the connection again.`);
  }

  const state = decryptJson<OAuthState>(value);

  if (state.appId !== appId) {
    throw new Error(`Invalid ${app.label} OAuth state.`);
  }

  return state;
}

export function clearMcpOAuthState(response: NextResponse, appId: McpAppId) {
  response.cookies.delete(getStateCookieName(getMcpAppConfig(appId)));
}

export function setMcpSession(
  response: NextResponse,
  appId: McpAppId,
  session: McpSession,
) {
  response.cookies.set(
    getSessionCookieName(getMcpAppConfig(appId)),
    encryptJson(session),
    cookieOptions(60 * 60 * 24 * 30),
  );
}

export function clearMcpSession(response: NextResponse, appId: McpAppId) {
  response.cookies.delete(getSessionCookieName(getMcpAppConfig(appId)));
}

export function readMcpSession(
  request: NextRequest,
  appId: McpAppId,
): McpSession | null {
  const value = request.cookies.get(getSessionCookieName(getMcpAppConfig(appId)))?.value;

  if (!value) {
    return null;
  }

  try {
    const session = decryptJson<Partial<McpSession>>(value);

    if (!session.accessToken || !session.clientId) {
      return null;
    }

    return {
      ...session,
      appId: session.appId ?? appId,
      accessToken: session.accessToken,
      clientId: session.clientId,
    };
  } catch {
    return null;
  }
}

export async function exchangeCodeForMcpTokens(params: {
  appId: McpAppId;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const metadata = await discoverMcpOAuthMetadata(params.appId);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "VoiceActionApp-MCP-Client/0.1",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `${getMcpAppConfig(params.appId).label} token exchange failed: ${await response.text()}`,
    );
  }

  return (await response.json()) as TokenResponse;
}

export async function refreshMcpSession(session: McpSession): Promise<McpSession> {
  if (!session.refreshToken) {
    throw new Error(`${getMcpAppConfig(session.appId).label} session expired. Reconnect it.`);
  }

  const metadata = await discoverMcpOAuthMetadata(session.appId);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  });

  if (session.clientSecret) {
    body.set("client_secret", session.clientSecret);
  }

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "VoiceActionApp-MCP-Client/0.1",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`${getMcpAppConfig(session.appId).label} session expired. Reconnect it.`);
  }

  const tokens = (await response.json()) as TokenResponse;

  return tokenResponseToMcpSession(
    session.appId,
    tokens,
    session.clientId,
    session.clientSecret,
  );
}

export function tokenResponseToMcpSession(
  appId: McpAppId,
  tokens: TokenResponse,
  clientId: string,
  clientSecret?: string,
): McpSession {
  return {
    appId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined,
    clientId,
    clientSecret,
  };
}

export async function getValidMcpSession(
  request: NextRequest,
  appId: McpAppId,
): Promise<{ session: McpSession; refreshed: boolean }> {
  const session = readMcpSession(request, appId);
  const app = getMcpAppConfig(appId);

  if (!session) {
    if (app.accessToken) {
      return {
        session: {
          appId,
          accessToken: app.accessToken,
          clientId: "env",
        },
        refreshed: false,
      };
    }

    throw new Error(`Connect ${app.label} before using its tools.`);
  }

  const shouldRefresh =
    typeof session.expiresAt === "number" &&
    session.expiresAt - Date.now() < 5 * 60 * 1000;

  if (!shouldRefresh) {
    return { session, refreshed: false };
  }

  return {
    session: await refreshMcpSession(session),
    refreshed: true,
  };
}
