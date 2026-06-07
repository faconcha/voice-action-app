import { NextRequest, NextResponse } from "next/server";

import {
  accessAuthConfigured,
  accessCookieMaxAge,
  accessCookieName,
  createAccessToken,
  verifyAccessPassword,
} from "@/app/lib/access-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!accessAuthConfigured()) {
    return NextResponse.redirect(
      new URL("/access?error=not-configured", request.url),
      303,
    );
  }

  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");

  if (!await verifyAccessPassword(password)) {
    return NextResponse.redirect(new URL("/access?error=invalid", request.url), 303);
  }

  const redirectTo = String(formData.get("redirectTo") ?? "/");
  const response = NextResponse.redirect(new URL(redirectTo || "/", request.url), 303);

  response.cookies.set(accessCookieName(), await createAccessToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: accessCookieMaxAge(),
  });

  return response;
}
