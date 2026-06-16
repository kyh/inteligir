# Chat from Slack, Telegram, WhatsApp & Discord

Talk to your Inteligir agent from external messaging apps. Built on Vercel's
[Chat SDK](https://chat-sdk.dev) (`chat` + `@chat-adapter/*`) as the platform
adapter layer, bridged to the on-desktop pi agent.

## Why a gateway + bridge

The agent runs in the **desktop** Electron main process — it needs machine-local
tools (browser automation, `peekaboo`, the executor daemon) and can't run in the
cloud. The Chat SDK is **webhook-driven** and needs a public URL. So the Chat SDK
gateway and the desktop relay both live in the **server** Cloudflare Worker
(`@repo/server`, `apps/server`): one public service receives the webhooks and
forwards them to the desktop over the WebSocket it already holds.

```
Slack / Telegram / WhatsApp / Discord
        │  platform webhook
        ▼
┌──────────────────────────────────────────────┐
│  Server worker  (@repo/server)                │
│  • Chat SDK webhook routes /api/webhooks/*    │
│  • handler → Durable Object (same room) ──────┼──── WebSocket ───► Desktop
│  • posts reply via the live thread     ◄──────┼──── chat_reply ──  (chat-bridge
│  • DO correlates request ↔ reply              │                     → 1 agent turn)
└──────────────────────────────────────────────┘
```

1. A platform delivers a message to `/api/webhooks/<platform>` on the worker.
2. The Chat SDK verifies the signature and calls our handler, which forwards the
   text to the worker's Durable Object and **blocks** on the reply.
3. The DO sends it over the desktop's WebSocket and waits for a `chat_reply`
   with the matching `correlationId`.
4. The desktop runs **one agent turn** and replies with the assistant's text.
5. The handler posts that text back through the live thread.

Wire protocol lives in `@repo/dispatch` (`chat_message` / `chat_reply` — see
[`packages/dispatch/PROTOCOL.md`](../packages/dispatch/PROTOCOL.md)). The
marketing site (`@repo/web`) is not involved.

## Setup

### 1. Enable Remote Access on the desktop

The chat bridge rides the same relay socket as mobile pairing, and Remote
Access is **opt-in and OFF by default** — with it off, the desktop holds no
socket and inbound chat returns `no_device`. In the desktop app, open the
Extensions panel and enable **Remote Access**. That mints a pairing credential
and shows a pairing string of the form `XXXX-XXXX-XXXX-XXXX.token`; the part
before the `.` is the `roomId` — set it as `CHAT_RELAY_ROOM` on the worker
(below). Rotating or disabling Remote Access changes the roomId — update the
worker or the chat bridge goes dark.

No desktop-side secret or env var is involved: the pairing token authenticates
the desktop's socket at connect time (the legacy `DISPATCH_CHAT_SECRET`
registration flow is gone).

### 2. Configure & deploy the server worker

Copy `apps/server/.dev.vars.example` → `.dev.vars` for local dev, or set the
same keys as secrets in production (`wrangler secret put <NAME>`):

```
CHAT_RELAY_SECRET=<random string — authenticates the gateway's call to the relay DO>
CHAT_RELAY_ROOM=<roomId from the desktop's pairing string>
```

…plus the per-platform credentials below, then `pnpm --filter @repo/server deploy`.
Note the worker host, e.g. `inteligir-server.<acct>.workers.dev`.

### 3. Per-platform credentials & webhook URLs

Point each platform's webhook at the **server worker** host:

| Platform     | Credentials                                                                                         | Webhook URL                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Slack**    | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                                           | `https://<server-host>/api/webhooks/slack`                           |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`                                               | `https://<server-host>/api/webhooks/telegram` (`setWebhook`)         |
| **WhatsApp** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | `https://<server-host>/api/webhooks/whatsapp` (GET verify + POST)    |
| **Discord**  | `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`                                 | `https://<server-host>/api/webhooks/discord` (Interactions endpoint) |

DM the bot, or @-mention it in a channel — it replies with the agent's answer.

## Security

Two independent credentials, one per hop (details in
[`packages/dispatch/PROTOCOL.md`](../packages/dispatch/PROTOCOL.md)):

- **Desktop ↔ relay room: the pairing token.** Enabling Remote Access mints a
  CSPRNG credential (80-bit roomId + 128-bit bearer token); the DO stores only
  `SHA-256(token)` on the desktop's first connect and refuses any later
  connection that doesn't hash-match. Only the token-authenticated desktop
  connection receives `chat_message` frames and can resolve a `chat_reply` — a
  room guesser can't impersonate the desktop or forge replies.
- **Gateway → relay DO: `CHAT_RELAY_SECRET`.** The webhook handler's internal
  POST to the DO carries it as an `x-relay-secret` header; the DO rejects any
  relay request without a matching secret.
- **Fail closed.** An unset `CHAT_RELAY_SECRET` means the DO refuses every
  relay POST — inbound chat is off, in local dev too. Remote Access disabled
  means no desktop is in the room and inbound chat returns `no_device`. A
  misconfigured deploy is unreachable rather than unauthenticated.

## Limitations (v1)

- **Single agent session, one turn at a time.** Every interface (and the desktop
  UI) funnels into the one shared session, serialized by the agent gateway
  (`main/dispatch/agent-gateway.ts`). The bridge runs a single chat turn at a
  time; an external message that arrives mid-turn gets an immediate "busy" reply
  rather than being queued, which keeps replies from crossing conversations and
  keeps the gateway request short. A turn started by the _desktop user_ still
  occupies the session; desktop/mobile commands sent during a chat turn queue
  and flush when it releases.
- **Single user / one room.** The gateway relays into one configured desktop
  room and to a single registered device. Multi-user per-conversation pairing is
  not implemented yet.
- **Discord messages need the Gateway.** The Interactions webhook handles
  verification and slash commands, but normal channel/DM messages arrive over a
  persistent Gateway WebSocket. Cloudflare Workers can't hold one open — run
  `startGatewayListener` (`/api/discord/gateway`, guarded by `CRON_SECRET`) from
  a long-running process or a Durable Object for full Discord message support.
  Slack / Telegram / WhatsApp are plain webhooks and need none of this.
- **Slack 3s retry.** A slow agent turn can exceed Slack's retry window. For
  production, add a persistent Chat SDK state adapter (Redis/Postgres) so retried
  events dedupe across requests instead of the in-memory default.
- **Reply latency.** The gateway holds the webhook request open while the desktop
  runs the turn — up to ~120s per turn, with the worker's reply timeout (150s)
  giving margin for the turn plus its interrupt-drain.
