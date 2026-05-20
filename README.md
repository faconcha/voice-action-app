# Voice Action App

Voice Action App is a mobile-first PWA for continuous realtime voice conversation with an AI thought partner. It uses OpenAI Realtime WebRTC for speech-to-speech interaction and routes structured actions through MCP servers for Notion and Google Calendar.

This is intentionally not a chatbot. The UI is one large voice control, a live status indicator, transcript context, and recent saved Notion items.

## Architecture

```text
Mobile PWA
  -> OpenAI Realtime API over WebRTC
  -> Next.js API routes
  -> Hosted MCP servers
  -> Notion workspace and Google Calendar
```

The browser owns microphone streaming, remote audio playback, interruption, and Realtime DataChannel events. The backend creates a short-lived Realtime client secret and dispatches allowed tool calls to app-specific MCP adapters.

## Implementation Notes

Realtime agent logic is intentionally separate from MCP execution logic:

- `app/api/realtime/session/route.ts` creates the ephemeral OpenAI Realtime session.
- `app/lib/realtime/useRealtimeVoice.ts` manages WebRTC, audio, transcript state, DataChannel events, and function-call outputs.
- `app/lib/realtime/tools.ts` contains the model-visible tool declarations sent to the Realtime session.
- `app/lib/shared/tools.ts` contains stable tool names and Zod schemas used to validate backend tool inputs.
- `app/api/mcp/tools/call/route.ts` is the only browser-facing MCP tool execution endpoint.
- `app/lib/server/tool-dispatcher.ts` routes validated app-level tools to the correct MCP adapter.
- `app/lib/server/notion-mcp.ts` and `app/lib/server/google-calendar-mcp.ts` translate app-level tool inputs into concrete MCP tool payloads.
- `app/lib/server/mcp-client.ts` and `app/lib/server/notion-mcp-client.ts` own Streamable HTTP MCP client calls.
- `app/lib/server/mcp-oauth.ts` owns OAuth discovery, dynamic client registration, PKCE, encrypted cookies, token refresh, and env-token fallback.

The stream agent model is `gpt-realtime` by default, configured by `OPENAI_REALTIME_MODEL`. The voice is `marin` by default, configured by `OPENAI_REALTIME_VOICE`. Input audio transcription uses `gpt-4o-mini-transcribe`.

## Requirements

- Node.js 20.9 or newer for Next.js 16
- An OpenAI API key with Realtime access
- MCP OAuth connections from the browser, or pre-authorized MCP access tokens for local smoke tests
- A Notion parent page or workspace destination configured for captures, such as `Sandbox de Ideas`

## Local Setup

```bash
cd voice-action-app
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000` on desktop or on your mobile device through your local network. Mobile Safari and Chrome require a secure context for microphone access outside localhost, so use HTTPS tunneling if testing from a physical phone against your laptop.

## Environment Variables

```bash
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=marin

MCP_COOKIE_SECRET=

NOTION_MCP_URL=https://mcp.notion.com/mcp
NOTION_COOKIE_SECRET=
NOTION_MCP_ACCESS_TOKEN=
NOTION_PARENT_PAGE_ID=

NOTION_MCP_CREATE_PAGE_TOOL=
NOTION_MCP_APPEND_NOTE_TOOL=
NOTION_MCP_LIST_RECENT_TOOL=
NOTION_MCP_FETCH_TOOL=

GOOGLE_CALENDAR_MCP_URL=https://gcal.mintmcp.com/mcp
GOOGLE_CALENDAR_MCP_AUTH_SERVER=
GOOGLE_CALENDAR_MCP_CLIENT_ID=
GOOGLE_CALENDAR_MCP_CLIENT_SECRET=
GOOGLE_CALENDAR_MCP_SCOPE=
GOOGLE_CALENDAR_MCP_CREATE_EVENT_TOOL=
GOOGLE_CALENDAR_MCP_LIST_EVENTS_TOOL=
GOOGLE_CALENDAR_MCP_ACCESS_TOKEN=

APP_DEFAULT_TIMEZONE=America/Santiago
```

`OPENAI_REALTIME_MODEL` should remain `gpt-realtime` for this MVP.

The optional `*_MCP_*_TOOL` variables exist because MCP servers can expose different concrete tool names. The app exposes app-level tools to the Realtime model and maps them to concrete MCP tools on the backend.

## Notion MCP Setup

The app connects to hosted Notion MCP through OAuth with PKCE.

1. Generate a cookie secret:

   ```bash
   openssl rand -base64 32
   ```

2. Set the value as `MCP_COOKIE_SECRET` locally and in Vercel. `NOTION_COOKIE_SECRET` still works for existing Notion-only installs.
3. Open the app and tap `Connect` next to Notion.
4. Authorize the Notion workspace.
5. Return to the app and confirm it says `Notion connected`.
6. If your Notion MCP server exposes different tool names, call the app once and read the returned error. It lists available MCP tool names. Put the matching names into the `NOTION_MCP_*_TOOL` variables.

The backend uses `NOTION_MCP_FETCH_TOOL` internally to inspect a target database/data-source schema before creating a page. This keeps database rows from being created with blank visible titles when the title column is named something like `Name` or `Idea` instead of `title`.

`NOTION_MCP_ACCESS_TOKEN` is optional and only kept as a fallback for non-OAuth experiments. The production app should use the Connect Notion flow.

The app never calls the Notion REST API directly.

## Google Calendar MCP Setup

Google Calendar support uses the same pattern as Notion: the app connects to a Google Calendar MCP server over Streamable HTTP, and OAuth happens through the MCP server.

- `GOOGLE_CALENDAR_MCP_URL`: MCP endpoint, defaults to `https://gcal.mintmcp.com/mcp`
- `GOOGLE_CALENDAR_MCP_AUTH_SERVER`: optional OAuth issuer/base URL when it differs from the MCP URL origin
- `GOOGLE_CALENDAR_MCP_CLIENT_ID` and `GOOGLE_CALENDAR_MCP_CLIENT_SECRET`: optional static MCP OAuth client credentials when the MCP server does not support dynamic client registration
- `GOOGLE_CALENDAR_MCP_CREATE_EVENT_TOOL` and `GOOGLE_CALENDAR_MCP_LIST_EVENTS_TOOL`: optional concrete tool-name overrides

With the default MintMCP Google Calendar endpoint, open the app and tap `Connect` next to Google Calendar. The Realtime agent can then call `create_calendar_event` and `list_calendar_events`, while the browser still only sends tool calls to `/api/mcp/tools/call`.

The app does not call the Google Calendar REST API directly. Calendar actions go through the configured Google Calendar MCP server.

## Testing MCP Tools Without Voice

The Realtime agent and MCP execution are separate. The fastest terminal smoke test is:

```bash
npm run mcp:smoke
```

That script writes `local_example/mcp-test-report.txt`. It performs real OAuth metadata discovery and dynamic client registration for Notion and Google Calendar. If `NOTION_MCP_ACCESS_TOKEN` and/or `GOOGLE_CALENDAR_MCP_ACCESS_TOKEN` are present, it also calls the actual MCP tools: it tries to create a Notion smoke-test page in `Sandbox de Ideas`, list calendar events, and create a Google Calendar smoke-test event.

You can also test a backend tool directly after connecting the relevant app in the browser:

```bash
curl -X POST http://localhost:3000/api/mcp/tools/call \
  -H "Content-Type: application/json" \
  --data '{"name":"list_calendar_events","arguments":{"limit":5}}'
```

For OAuth-cookie based sessions, run the request from the browser devtools console or include the browser cookies in your curl request.

Useful direct tool names are `create_notion_page`, `append_note`, `list_recent_ideas`, `create_calendar_event`, and `list_calendar_events`.

## OpenAI Realtime Setup

The app uses the official WebRTC pattern:

- `getUserMedia` for microphone input
- `RTCPeerConnection` for streaming audio
- remote audio playback from the peer connection track
- `RTCDataChannel` for Realtime events and tool call outputs
- `POST /api/realtime/session` to mint a short-lived client secret

The Realtime session uses the exact Voice Action App system prompt in `app/lib/realtime/prompt.ts`.

## Vercel Deployment

The project is connected to GitHub through Vercel. Pushing to `main` should trigger a production deployment automatically.

Production URL:

```text
https://voice-action-app.vercel.app
```

Normal update flow:

```bash
git status
npm run typecheck
npm run lint
git add .
git commit -m "Describe the change"
git push
```

If an automatic deployment does not start, run a manual production deploy:

```bash
npm run deploy
```

If the project ever needs to be recreated manually:

1. Run `npx vercel login`.
2. Run `npx vercel --prod`.
3. Add the environment variables from `.env.example` to the Vercel project.
4. Connect the GitHub repo in Vercel or redeploy with `npm run deploy`.

No database is required. The production MVP is single-user: Notion access is provided by the configured MCP credential, not by an app auth flow.

## PWA Install

- iOS Safari: open the site, tap Share, then Add to Home Screen.
- Chrome Android: open the site and use Install app from the browser menu or prompt.

## Scripts

```bash
npm run dev
npm run typecheck
npm run lint
npm run mcp:smoke
npm run build
npm run deploy
```

## Manual Acceptance Test

1. Start the app and grant microphone permission.
2. Confirm the status changes from Connecting to Listening.
3. Speak naturally and verify transcript entries appear.
4. Let the assistant respond with voice.
5. Interrupt while the assistant is speaking.
6. Say a clear idea or todo and verify the app saves it through MCP.
7. Confirm the assistant says, "Saved to Notion."
8. Refresh recent saved items and verify the saved item appears.
