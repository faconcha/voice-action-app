"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { VOICE_INBOX_SYSTEM_PROMPT } from "@/app/lib/realtime/prompt";
import { realtimeTools, type RecentIdea } from "@/app/lib/shared/tools";

type ConnectionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "saving"
  | "reconnecting"
  | "error";

type TranscriptEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
};

type RealtimeServerEvent = {
  type?: string;
  response?: {
    output?: Array<Record<string, unknown>>;
  };
  item?: Record<string, unknown>;
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
  transcript?: string;
  error?: {
    message?: string;
  };
};

type PendingToolCall = {
  callId: string;
  name: string;
  argsText: string;
};

function getClientSecret(payload: unknown): string {
  const record = payload as Record<string, unknown>;
  const value = record.value;

  if (typeof value === "string") {
    return value;
  }

  const clientSecret = record.client_secret as Record<string, unknown> | undefined;

  if (typeof clientSecret?.value === "string") {
    return clientSecret.value;
  }

  throw new Error("Realtime session response did not include a client secret.");
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

const completionEventTypes = new Set([
  "response.output_item.done",
  "response.done",
]);

function parseToolCalls(event: RealtimeServerEvent): PendingToolCall[] {
  const directCallId = event.call_id;

  if (
    event.type === "response.function_call_arguments.done" &&
    typeof directCallId === "string" &&
    typeof event.name === "string"
  ) {
    return [
      {
        callId: directCallId,
        name: event.name,
        argsText: event.arguments ?? "{}",
      },
    ];
  }

  if (!event.type || !completionEventTypes.has(event.type)) {
    return [];
  }

  const candidates = [
    event.item,
    ...(event.response?.output ?? []),
  ].filter(Boolean) as Array<Record<string, unknown>>;

  return candidates
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      callId: String(item.call_id ?? item.callId ?? ""),
      name: String(item.name ?? ""),
      argsText: String(item.arguments ?? "{}"),
    }))
    .filter((call) => call.callId && call.name && call.argsText.trim().length > 0);
}

function parseArgs(argsText: string): unknown {
  try {
    return JSON.parse(argsText);
  } catch {
    return {};
  }
}

function normalizePriority(value: unknown): RecentIdea["priority"] {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

export function useRealtimeVoice() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [recentItems, setRecentItems] = useState<RecentIdea[]>([]);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const handledCallsRef = useRef(new Set<string>());
  const assistantDraftRef = useRef("");

  const addTranscript = useCallback(
    (role: TranscriptEntry["role"], text: string) => {
      const clean = text.trim();

      if (!clean) {
        return;
      }

      setTranscript((items) => [
        ...items.slice(-39),
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role,
          text: clean,
          at: nowLabel(),
        },
      ]);
    },
    [],
  );

  const stop = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }

    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    handledCallsRef.current.clear();
    assistantDraftRef.current = "";
    setStatus("idle");
  }, []);

  const sendRealtimeEvent = useCallback((event: unknown) => {
    const channel = channelRef.current;

    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(event));
    }
  }, []);

  const sendToolOutput = useCallback(
    (callId: string, output: unknown) => {
      sendRealtimeEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      });
      sendRealtimeEvent({ type: "response.create" });
    },
    [sendRealtimeEvent],
  );

  const callBackendTool = useCallback(
    async (toolCall: PendingToolCall) => {
      if (handledCallsRef.current.has(toolCall.callId)) {
        return;
      }

      handledCallsRef.current.add(toolCall.callId);
      setStatus("saving");

      try {
        const response = await fetch("/api/mcp/tools/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: toolCall.name,
            arguments: parseArgs(toolCall.argsText),
          }),
        });
        const result = (await response.json()) as {
          ok?: boolean;
          message?: string;
          recentItems?: RecentIdea[];
          error?: string;
        };

        if (!response.ok || result.ok === false) {
          throw new Error(result.error ?? result.message ?? "Tool call failed.");
        }

        if (result.recentItems?.length) {
          setRecentItems(result.recentItems);
        } else if (
          toolCall.name === "create_notion_page" ||
          toolCall.name === "append_note"
        ) {
          const args = parseArgs(toolCall.argsText) as Record<string, unknown>;
          setRecentItems((items) => [
            {
              id: `${toolCall.callId}-${String(args.title ?? "Saved note")}`,
              title: String(args.title ?? "Saved note"),
              summary:
                typeof args.summary === "string" ? args.summary : undefined,
              tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
              priority: normalizePriority(args.priority),
              createdAt: new Date().toISOString(),
            },
            ...items,
          ].slice(0, 8));
        }

        addTranscript("system", result.message ?? "Saved to Notion.");
        sendToolOutput(toolCall.callId, result);
        setStatus("listening");
      } catch (toolError) {
        const message =
          toolError instanceof Error ? toolError.message : "Tool call failed.";
        setError(message);
        addTranscript("system", message);
        sendToolOutput(toolCall.callId, { ok: false, error: message });
        setStatus("error");
      }
    },
    [addTranscript, sendToolOutput],
  );

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      if (event.error?.message) {
        setError(event.error.message);
        setStatus("error");
      }

      if (event.type === "response.audio.delta") {
        setStatus("speaking");
      }

      if (event.type === "response.audio.done") {
        setStatus("listening");
      }

      if (
        event.type === "conversation.item.input_audio_transcription.completed" &&
        typeof event.transcript === "string"
      ) {
        addTranscript("user", event.transcript);
      }

      if (
        event.type === "response.audio_transcript.delta" &&
        typeof event.delta === "string"
      ) {
        assistantDraftRef.current += event.delta;
      }

      if (event.type === "response.audio_transcript.done") {
        addTranscript("assistant", assistantDraftRef.current);
        assistantDraftRef.current = "";
      }

      for (const toolCall of parseToolCalls(event)) {
        void callBackendTool(toolCall);
      }
    },
    [addTranscript, callBackendTool],
  );

  const refreshRecentItems = useCallback(async () => {
    try {
      const response = await fetch("/api/mcp/tools/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "list_recent_ideas",
          arguments: { limit: 5 },
        }),
      });
      const result = (await response.json()) as { recentItems?: RecentIdea[] };

      if (response.ok && result.recentItems) {
        setRecentItems(result.recentItems);
      }
    } catch {
      // MCP apps may not be configured yet; the active voice session will surface errors.
    }
  }, []);

  const start = useCallback(async () => {
    stop();
    setStatus("connecting");
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is not available in this browser.");
      }

      const tokenResponse = await fetch("/api/realtime/session", {
        method: "POST",
      });
      const tokenPayload = await tokenResponse.json();

      if (!tokenResponse.ok) {
        const detail =
          typeof tokenPayload.detail === "object" && tokenPayload.detail
            ? JSON.stringify(tokenPayload.detail)
            : undefined;
        throw new Error(
          [tokenPayload.error, detail].filter(Boolean).join(" ") ||
            "Could not create Realtime session.",
        );
      }

      const clientSecret = getClientSecret(tokenPayload);
      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audio = document.createElement("audio");

      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        void audio.play().catch(() => {
          setError("Tap Start again if the browser blocks audio playback.");
        });
      };

      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

      channel.onopen = () => {
        setStatus("listening");
        sendRealtimeEvent({
          type: "session.update",
          session: {
            type: "realtime",
            model: "gpt-realtime",
            instructions: VOICE_INBOX_SYSTEM_PROMPT,
            tools: realtimeTools,
            tool_choice: "auto",
          },
        });
      };
      channel.onmessage = (message) => {
        try {
          handleServerEvent(JSON.parse(message.data) as RealtimeServerEvent);
        } catch {
          // Ignore malformed data-channel messages.
        }
      };
      channel.onerror = () => {
        setError("Realtime data channel error.");
        setStatus("error");
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed") {
          setStatus("reconnecting");
          reconnectTimerRef.current = window.setTimeout(() => {
            void startRef.current?.();
          }, 900);
        }

        if (peer.connectionState === "disconnected") {
          setStatus("reconnecting");
        }
      };

      peerRef.current = peer;
      channelRef.current = channel;
      streamRef.current = stream;
      audioRef.current = audio;

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
        },
      );

      if (!sdpResponse.ok) {
        throw new Error(await sdpResponse.text());
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
      void refreshRecentItems();
    } catch (startError) {
      stop();
      setStatus("error");
      setError(
        startError instanceof Error
          ? startError.message
          : "Could not start voice session.",
      );
    }
  }, [handleServerEvent, refreshRecentItems, sendRealtimeEvent, stop]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => stop, [stop]);

  return {
    status,
    error,
    transcript,
    recentItems,
    isActive: status !== "idle" && status !== "error",
    start,
    stop,
    reconnect: start,
    refreshRecentItems,
  };
}
