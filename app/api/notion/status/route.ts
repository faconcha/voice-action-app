import { NextRequest, NextResponse } from "next/server";

import { readNotionSession } from "@/app/lib/server/notion-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = readNotionSession(request);

  return NextResponse.json({
    connected: Boolean(session?.accessToken),
    expiresAt: session?.expiresAt,
  });
}
