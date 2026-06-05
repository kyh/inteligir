# Chat from Slack, Telegram, WhatsApp & Discord

Talk to your Inteligir agent from external messaging apps. Built on Vercel's
[Chat SDK](https://chat-sdk.dev) (`chat` + `@chat-adapter/*`) as the platform
adapter layer, bridged to the on-desktop pi agent.

## Why a gateway + bridge

The agent runs in the **desktop** Electron main process — it needs machine-local
tools (browser automation, `peekaboo`, the executor daemon) and can't run in the
cloud. The Chat SDK is **webhook-driven** and needs a public URL. So the Chat SDK
gateway and the desktop relay both live in the **party** Cloudflare Worker
(`@repo/party`): one public service receives the webhooks and forwards them to
the desktop over the WebSocket it already holds.

```
Slack / Telegram / WhatsApp / Discord
        │  platform webhook
        ▼
┌──────────────────────────────────────────────┐
│  Party worker  (@repo/party)                  │
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

Wire protocol lives in `@repo/dispatch` (`chat_message` / `chat_reply`). The
marketing site (`@repo/web`) is not involved.

## Setup

### 1. Pair the desktop

Open the desktop app and copy its **dispatch room code** (the same code used for
mobile pairing). Set it as `CHAT_RELAY_ROOM` on the worker (below). Set
`DISPATCH_CHAT_SECRET` in the desktop's environment to the same value as the
worker's `CHAT_RELAY_SECRET` — the desktop presents it to register as the agent
host. In local dev, leave both unset and registration stays open.

### 2. Configure & deploy the party worker

Copy `apps/party/.dev.vars.example` → `.dev.vars` for local dev, or set the same
keys as secrets in production (`wrangler secret put <NAME>`):

```
CHAT_RELAY_SECRET=<random string, also the desktop's DISPATCH_CHAT_SECRET>
CHAT_RELAY_ROOM=<desktop room code>
```

…plus the per-platform credentials below, then `pnpm --filter @repo/party deploy`.
Note the worker host, e.g. `inteligir-party.<acct>.workers.dev`.

### 3. Per-platform credentials & webhook URLs

Point each platform's webhook at the **party worker** host:

| Platform | Credentials | Webhook URL |
|----------|-------------|-------------|
| **Slack** | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | `https://<party-host>/api/webhooks/slack` |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` | `https://<party-host>/api/webhooks/telegram` (`setWebhook`) |
| **WhatsApp** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | `https://<party-host>/api/webhooks/whatsapp` (GET verify + POST) |
| **Discord** | `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` | `https://<party-host>/api/webhooks/discord` (Interactions endpoint) |

DM the bot, or @-mention it in a channel — it replies with the agent's answer.

## Security

The relay room is reachable by anyone who knows the 6-char room code, so the
chat bridge authenticates with a shared secret that must match on both sides:
the worker's `CHAT_RELAY_SECRET` and the desktop's `DISPATCH_CHAT_SECRET`.

- The desktop presents the secret to register as the agent host; only a
  registered (authenticated) device receives chat messages and can resolve a
  reply — a room intruder can't impersonate the desktop or forge replies.
- The internal relay call from the gateway handler to the DO carries the secret
  too.
- **Set the secret in production.** When `CHAT_RELAY_SECRET` is unset the relay
  leaves registration open for local dev — don't deploy that way.

## Limitations (v1)

- **Single agent session, one turn at a time.** Every interface (and the desktop
  UI) funnels into the one shared session. The bridge runs a single chat turn at
  a time; a message that arrives mid-turn gets an immediate "busy" reply rather
  than being queued, which keeps replies from crossing conversations and keeps
  the gateway request short. A turn started by the *desktop user* still occupies
  the session.
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
