# Chat from Slack, Telegram, WhatsApp & Discord

Talk to your Inteligir agent from external messaging apps. Built on Vercel's
[Chat SDK](https://chat-sdk.dev) (`chat` + `@chat-adapter/*`) as the platform
adapter layer, bridged to the on-desktop pi agent.

## Why a gateway + bridge

The agent runs in the **desktop** Electron main process — it needs machine-local
tools (browser automation, `peekaboo`, the executor daemon) and can't run in the
cloud. The Chat SDK is **webhook-driven** and needs a public URL. So:

```
Slack / Telegram / WhatsApp / Discord
        │  (platform webhook)
        ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Gateway  (@repo/web)         │  POST   │  Party relay  (@repo/party)  │
│  Chat SDK webhook routes      │ ──────► │  Durable Object, one room    │
│  /api/webhooks/<platform>     │         │  correlates request ↔ reply  │
│  posts the reply via thread   │ ◄────── │                              │
└──────────────────────────────┘  reply  └──────────────┬───────────────┘
                                                         │ WebSocket
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │  Desktop  (@repo/desktop)    │
                                          │  chat-bridge → agent turn →  │
                                          │  chat_reply                  │
                                          └──────────────────────────────┘
```

1. A platform delivers a message to `/api/webhooks/<platform>` in the web app.
2. The Chat SDK verifies the signature and calls our handler, which `POST`s the
   text into the desktop's party room and **blocks** on the reply.
3. The party Durable Object forwards it over the desktop's WebSocket, then waits
   for a `chat_reply` with the matching `correlationId`.
4. The desktop runs **one agent turn** and replies with the assistant's text.
5. The gateway posts that text back through the live thread handle.

Wire protocol lives in `@repo/dispatch` (`chat_message` / `chat_reply`).

## Setup

### 1. Deploy the party relay

```bash
cd apps/party
wrangler secret put CHAT_RELAY_SECRET   # any random string
pnpm deploy
```

Note its host, e.g. `inteligir-party.<acct>.workers.dev`.

### 2. Pair the desktop

Open the desktop app and copy its **dispatch room code** (the same code used for
mobile pairing). This is the room the gateway relays into.

Set `DISPATCH_CHAT_SECRET` in the desktop's environment to the **same value** as
the party's `CHAT_RELAY_SECRET`. The desktop presents it when registering as the
agent host; without a matching secret the relay won't route chat to it (in
production — see Security below). In local dev, leave the secret unset
everywhere and registration stays open.

### 3. Configure & deploy the gateway (`apps/web`)

Copy `apps/web/.dev.vars.example` → `.dev.vars` for local dev, or set the same
keys as Cloudflare secrets in production:

```
CHAT_RELAY_PARTY_HOST=inteligir-party.<acct>.workers.dev
CHAT_RELAY_ROOM=<desktop room code>
CHAT_RELAY_SECRET=<same as the party secret>
```

…plus the per-platform credentials below. Then `pnpm --filter @repo/web deploy`.

### 4. Per-platform credentials & webhook URLs

| Platform | Credentials | Webhook URL |
|----------|-------------|-------------|
| **Slack** | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | `/api/webhooks/slack` (Event Subscriptions) |
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` | `/api/webhooks/telegram` (`setWebhook`) |
| **WhatsApp** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | `/api/webhooks/whatsapp` (GET verify + POST) |
| **Discord** | `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` | `/api/webhooks/discord` (Interactions endpoint) |

DM the bot, or @-mention it in a channel — it replies with the agent's answer.

## Security

The relay room is reachable by anyone who knows the 6-char room code, so the
chat bridge authenticates with a shared secret that must match on all three
sides: the party's `CHAT_RELAY_SECRET`, the gateway's `CHAT_RELAY_SECRET`, and
the desktop's `DISPATCH_CHAT_SECRET`.

- The gateway's inbound `POST` carries the secret (`x-relay-secret`); the room
  rejects mismatches, so only your gateway can inject messages.
- The desktop presents the secret to register as the agent host; only a
  registered (authenticated) device receives chat messages and can resolve a
  reply — a room intruder can't impersonate the desktop or forge replies.
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
  room. Multi-user routing (per-conversation pairing) is not implemented yet.
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
  runs the turn — up to ~120s per turn, with the party room's reply timeout
  (150s) giving margin for the turn plus its interrupt-drain.
