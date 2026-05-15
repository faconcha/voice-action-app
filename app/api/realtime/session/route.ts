import { NextResponse } from "next/server";

import { VOICE_INBOX_SYSTEM_PROMPT } from "@/app/lib/realtime/prompt";
import { getRealtimeConfig } from "@/app/lib/server/env";
import { realtimeTools } from "@/app/lib/shared/tools";

export const runtime = "nodejs";

export async function POST() {
  try {
    const config = getRealtimeConfig();
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: config.model,
            instructions: VOICE_INBOX_SYSTEM_PROMPT,
            audio: {
              input: {
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 700,
                  create_response: true,
                  interrupt_response: true,
                },
                transcription: {
                  model: "gpt-4o-mini-transcribe",
                },
              },
              output: {
                voice: config.voice,
              },
            },
            tools: realtimeTools,
            tool_choice: "auto",
          },
        }),
      },
    );

    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to create Realtime session.", detail: payload },
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown session error.",
      },
      { status: 500 },
    );
  }
}
