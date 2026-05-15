import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

const AUTH_STATE_COOKIE = "voice_action_notion_oauth";
const SESSION_COOKIE = "voice_action_notion_session";
const MCP_AUTH_SERVER = "https://mcp.notion.com";

type OAuthMetadata = {
  issuer: string;
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

export type NotionSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  clientSecret?: string;
};

type OAuthState = {
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
  const secret = process.env.NOTION_COOKIE_SECRET;

  if (!secret) {
    throw new Error("Missing NOTION_COOKIE_SECRET. Generate one with `openssl rand -base64 32`.");
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

export function getBaseUrl(request: NextRequest | Request) {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";

  if (!host) {
    throw new Error("Could not determine request host.");
  }

  return `${proto}://${host}`;
}

export async function discoverNotionOAuthMetadata(): Promise<OAuthMetadata> {
  const response = await fetch(
    `${MCP_AUTH_SERVER}/.well-known/oauth-authorization-server`,
    {
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(`Could not discover Notion OAuth metadata: ${response.status}`);
  }

  const metadata = (await response.json()) as OAuthMetadata;

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("Notion OAuth metadata is missing required endpoints.");
  }

  return metadata;
}

export async function registerNotionOAuthClient(
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<ClientCredentials> {
  if (!metadata.registration_endpoint) {
    throw new Error("Notion OAuth metadata did not include a registration endpoint.");
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
    throw new Error(`Notion client registration failed: ${await response.text()}`);
  }

  return (await response.json()) as ClientCredentials;
}

function getPublicAppUrl(redirectUri: string) {
  const url = new URL(redirectUri);
  return url.origin;
}

export function generatePkce() {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );

  return { codeVerifier, codeChallenge };
}

export function setOAuthState(response: NextResponse, state: OAuthState) {
  response.cookies.set(
    AUTH_STATE_COOKIE,
    encryptJson(state),
    cookieOptions(10 * 60),
  );
}

export function readOAuthState(request: NextRequest): OAuthState {
  const value = request.cookies.get(AUTH_STATE_COOKIE)?.value;

  if (!value) {
    throw new Error("Missing Notion OAuth state. Start the connection again.");
  }

  return decryptJson<OAuthState>(value);
}

export function clearOAuthState(response: NextResponse) {
  response.cookies.delete(AUTH_STATE_COOKIE);
}

export function setNotionSession(response: NextResponse, session: NotionSession) {
  response.cookies.set(
    SESSION_COOKIE,
    encryptJson(session),
    cookieOptions(60 * 60 * 24 * 30),
  );
}

export function clearNotionSession(response: NextResponse) {
  response.cookies.delete(SESSION_COOKIE);
}

export function readNotionSession(request: NextRequest): NotionSession | null {
  const value = request.cookies.get(SESSION_COOKIE)?.value;

  if (!value) {
    return null;
  }

  try {
    return decryptJson<NotionSession>(value);
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const metadata = await discoverNotionOAuthMetadata();
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
    throw new Error(`Notion token exchange failed: ${await response.text()}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function refreshNotionSession(
  session: NotionSession,
): Promise<NotionSession> {
  if (!session.refreshToken) {
    throw new Error("Notion session expired. Reconnect Notion.");
  }

  const metadata = await discoverNotionOAuthMetadata();
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
    throw new Error("Notion session expired. Reconnect Notion.");
  }

  const tokens = (await response.json()) as TokenResponse;

  return tokenResponseToSession(tokens, session.clientId, session.clientSecret);
}

export function tokenResponseToSession(
  tokens: TokenResponse,
  clientId: string,
  clientSecret?: string,
): NotionSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined,
    clientId,
    clientSecret,
  };
}

export async function getValidNotionSession(
  request: NextRequest,
): Promise<{ session: NotionSession; refreshed: boolean }> {
  const session = readNotionSession(request);

  if (!session) {
    throw new Error("Connect Notion before saving notes.");
  }

  const shouldRefresh =
    typeof session.expiresAt === "number" &&
    session.expiresAt - Date.now() < 5 * 60 * 1000;

  if (!shouldRefresh) {
    return { session, refreshed: false };
  }

  return {
    session: await refreshNotionSession(session),
    refreshed: true,
  };
}
