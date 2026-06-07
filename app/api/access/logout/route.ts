import { NextRequest, NextResponse } from "next/server";

import { accessCookieName } from "@/app/lib/access-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/access", request.url));

  response.cookies.delete(accessCookieName());

  return response;
}
