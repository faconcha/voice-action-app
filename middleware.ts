import { NextRequest, NextResponse } from "next/server";

import {
  accessAuthConfigured,
  accessCookieName,
  verifyAccessToken,
} from "@/app/lib/access-auth";

const PUBLIC_FILE = /\.(.*)$/;

function shouldSkip(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/access") ||
    pathname.startsWith("/api/access") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    PUBLIC_FILE.test(pathname)
  );
}

function shouldProtect() {
  return accessAuthConfigured() || process.env.NODE_ENV === "production";
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (shouldSkip(pathname) || !shouldProtect()) {
    return NextResponse.next();
  }

  const authenticated = await verifyAccessToken(
    request.cookies.get(accessCookieName())?.value,
  );

  if (authenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/access";
  url.search = "";
  url.searchParams.set("redirect", `${pathname}${search}`);

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
