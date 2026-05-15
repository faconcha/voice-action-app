import { NextResponse } from "next/server";
import { z } from "zod";

import { callVoiceInboxTool } from "@/app/lib/server/notion-mcp";
import { isAllowedToolName } from "@/app/lib/shared/tools";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string(),
  arguments: z.unknown().optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());

    if (!isAllowedToolName(body.name)) {
      return NextResponse.json(
        { ok: false, error: `Tool "${body.name}" is not allowed.` },
        { status: 400 },
      );
    }

    const result = await callVoiceInboxTool(body.name, body.arguments ?? {});
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : error instanceof Error
          ? error.message
          : "Unknown tool error.";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
