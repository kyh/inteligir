# `@repo/server` — Inteligir relay Worker

Cloudflare Worker (partyserver) that does two jobs:

1. **WebSocket relay** — pairs the mobile app to the desktop. The two peers meet
   in a Durable Object "room"; the Worker authenticates each socket and shuttles
   dispatch-protocol frames between them. It stores no agent data and only ever
   sees the token's SHA-256 hash.
2. **External chat gateway** (optional) — a Chat SDK gateway hosted alongside the
   relay so Slack / Telegram / WhatsApp / Discord webhooks can reach the desktop
   agent through the same room. Single-tenant in v1 (one desktop per Worker).

Deployed to Cloudflare as `inteligir-server` via
[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

## Layout

```
src/
  server.ts          DispatchServer Durable Object — connect-time auth, room
                     presence, frame relay, gateway POST handler
  bot.ts             Chat SDK gateway — adapters (Slack/Telegram/WhatsApp/Discord)
  housekeeping.ts    Room claims, dedupe, idle-TTL sweep
  token-bucket.ts    Per-connection rate limiting
  env.ts             Env var schema + hasValidEnvVars guard
  *.test.ts          Vitest suites (housekeeping, token-bucket)
wrangler.jsonc       Worker config (DO bindings, routes)
.dev.vars.example    Local secrets template — copy to .dev.vars
```

## Auth & trust

Clients authenticate at connect time: `role` + raw pairing token travel as query
params on the WSS URL (`parseConnectionAuth` in `onConnect`). A missing role,
missing token, or token-hash mismatch is refused before the socket enters the
room. Per-connection state (`role`) is only written after auth succeeds, so
`state?.role` doubles as the "is authenticated" check. See
[`packages/dispatch/PROTOCOL.md`](../../packages/dispatch/PROTOCOL.md) for the
full trust model.

The relay itself needs **no** configuration — rooms are claimed by the desktop's
pairing credential. Everything in `.dev.vars.example` powers the optional chat
gateway, which fails closed: unset `CHAT_RELAY_SECRET` ⇒ the DO refuses every
gateway POST ⇒ inbound chat is disabled.

## Dev

```bash
pnpm dev:server      # wrangler dev (localhost:8787)
```

Copy `.dev.vars.example` → `.dev.vars` and fill in chat secrets only if you're
working on the gateway. In production set each with `wrangler secret put <NAME>`.

## Test & deploy

```bash
pnpm --filter @repo/server test      # vitest run
pnpm --filter @repo/server deploy    # wrangler deploy (usually via CI)
```
