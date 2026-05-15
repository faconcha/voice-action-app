import { NextResponse } from "next/server";

import { clearNotionSession } from "@/app/lib/server/notion-oauth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearNotionSession(response);
  return response;
}
