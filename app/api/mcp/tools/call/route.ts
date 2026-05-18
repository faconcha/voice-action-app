import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  dispatchToolCall,
  persistRefreshedSession,
} from "@/app/lib/server/tool-dispatcher";
import { isAllowedToolName } from "@/app/lib/shared/tools";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string(),
  arguments: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());

    if (!isAllowedToolName(body.name)) {
      return NextResponse.json(
        { ok: false, error: `Tool "${body.name}" is not allowed.` },
        { status: 400 },
      );
    }

    const { result, refreshedSession } = await dispatchToolCall(
      request,
      body.name,
      body.arguments ?? {},
    );
    const response = NextResponse.json(result, { status: result.ok ? 200 : 502 });

    persistRefreshedSession(response, refreshedSession);

    return response;
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : error instanceof Error
          ? error.message
          : "Unknown tool error.";

    console.error("[mcp/tools/call]", message);

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
