const COOKIE_NAME = "voice_action_access";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

function getAccessPassword() {
  return process.env.APP_ACCESS_PASSWORD;
}

function getSigningSecret() {
  return process.env.APP_ACCESS_SECRET ?? process.env.APP_ACCESS_PASSWORD;
}

function base64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function sign(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return base64Url(signature);
}

export function accessAuthConfigured() {
  return Boolean(getAccessPassword());
}

export function accessCookieName() {
  return COOKIE_NAME;
}

export function accessCookieMaxAge() {
  return THIRTY_DAYS_SECONDS;
}

export async function createAccessToken() {
  const secret = getSigningSecret();

  if (!secret) {
    throw new Error("Missing APP_ACCESS_PASSWORD.");
  }

  const expiresAt = Date.now() + THIRTY_DAYS_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = await sign(payload, secret);

  return `${payload}.${signature}`;
}

export async function verifyAccessPassword(password: string) {
  return Boolean(getAccessPassword() && password === getAccessPassword());
}

export async function verifyAccessToken(token?: string) {
  const secret = getSigningSecret();

  if (!secret || !token) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 3 || parts[0] !== "v1") {
    return false;
  }

  const payload = `${parts[0]}.${parts[1]}`;
  const expiresAt = Number(parts[1]);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  return parts[2] === await sign(payload, secret);
}
