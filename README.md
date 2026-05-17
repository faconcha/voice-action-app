# Voice Action App

Voice Action App is a mobile-first PWA for continuous realtime voice conversation with an AI thought partner. It uses OpenAI Realtime WebRTC for speech-to-speech interaction and routes structured capture actions through a Notion MCP server.

This is intentionally not a chatbot. The UI is one large voice control, a live status indicator, transcript context, and recent saved Notion items.

## Architecture

```text
Mobile PWA
  -> OpenAI Realtime API over WebRTC
  -> Next.js API routes
  -> Notion hosted MCP server
  -> Notion workspace
```

The browser owns microphone streaming, remote audio playback, interruption, and Realtime DataChannel events. The backend only creates a short-lived Realtime client secret and proxies the three allowed tool calls to Notion MCP.

## Requirements

- Node.js 20.9 or newer for Next.js 16
- An OpenAI API key with Realtime access
- A pre-authorized Notion MCP access token for the single workspace/user
- A Notion parent page or workspace destination configured for captures

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

NOTION_MCP_URL=https://mcp.notion.com/mcp
NOTION_COOKIE_SECRET=
NOTION_MCP_ACCESS_TOKEN=
NOTION_PARENT_PAGE_ID=

NOTION_MCP_CREATE_PAGE_TOOL=
NOTION_MCP_APPEND_NOTE_TOOL=
NOTION_MCP_LIST_RECENT_TOOL=
NOTION_MCP_FETCH_TOOL=
```

`OPENAI_REALTIME_MODEL` should remain `gpt-realtime` for this MVP.

The optional `NOTION_MCP_*_TOOL` variables exist because MCP servers can expose different concrete tool names. The app still exposes only `create_notion_page`, `append_note`, and `list_recent_ideas` to the Realtime model.

## Notion MCP Setup

The app connects to hosted Notion MCP through OAuth with PKCE.

1. Generate a cookie secret:

   ```bash
   openssl rand -base64 32
   ```

2. Set the value as `NOTION_COOKIE_SECRET` locally and in Vercel.
3. Open the app and tap `Connect Notion`.
4. Authorize the Notion workspace.
5. Return to the app and confirm it says `Notion connected`.
6. If your Notion MCP server exposes different tool names, call the app once and read the returned error. It lists available MCP tool names. Put the matching names into the `NOTION_MCP_*_TOOL` variables.

The backend uses `NOTION_MCP_FETCH_TOOL` internally to inspect a target database/data-source schema before creating a page. This keeps database rows from being created with blank visible titles when the title column is named something like `Name` or `Idea` instead of `title`. The Realtime model still only sees the three app tools: `create_notion_page`, `append_note`, and `list_recent_ideas`.

`NOTION_MCP_ACCESS_TOKEN` is optional and only kept as a fallback for non-OAuth experiments. The production app should use the Connect Notion flow.

The app never calls the Notion REST API directly.

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
