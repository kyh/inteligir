import { routePartykitRequest, Server, type Connection, type WSMessage } from "partyserver";
import {
  CHAT_DEVICE_REGISTER_TYPE,
  CHAT_MESSAGE_TYPE,
  CHAT_REPLY_TYPE,
  encodeMessage,
  parseChatReply,
  parseMessage,
} from "@repo/dispatch";

import { getBot } from "./bot";
import type { Env } from "./env";

/** Connection state — `device: true` marks a real agent host (the desktop),
 * stored on the connection so it survives Durable Object hibernation. */
type ConnState = { device?: boolean };

/** How long the gateway's inbound POST waits for the desktop to answer before
 * giving up. Must exceed the desktop's per-turn budget (120s) plus its
 * interrupt-drain grace so a slow-but-completing turn still lands inside the
 * window. The desktop processes one chat turn at a time and replies to any
 * message that arrives mid-turn immediately ("busy"), so this only ever covers
 * a single turn — not a queue backlog. */
const REPLY_TIMEOUT_MS = 150_000;

/**
 * Dispatch relay room. Two roles share a room:
 *
 *  - **WebSocket clients** (the desktop, the mobile app) connect and exchange
 *    ephemeral relay traffic. `onMessage` forwards each message to every other
 *    connection — the original mobile ↔ desktop behaviour.
 *
 *  - **HTTP POST** (the Chat SDK gateway in @repo/web) injects a `chat_message`
 *    via `onRequest` and blocks until the desktop replies with a matching
 *    `chat_reply`. This makes the room a correlated request/response bridge for
 *    external messaging interfaces, not just a fire-and-forget relay.
 */
export class DispatchServer extends Server<Env> {
  /** correlationId -> resolver for an in-flight gateway POST awaiting a reply. */
  private readonly pending = new Map<string, (text: string) => void>();

  onMessage(sender: Connection<ConnState>, message: WSMessage): void {
    // Intercept chat replies from the desktop and resolve the waiting HTTP
    // request instead of relaying them to other sockets.
    if (typeof message === "string") {
      const parsed = parseMessage(message);

      // Registration handshake: mark this socket as a real agent host so the
      // chat relay can target it. Gated on the shared secret so a peer that
      // merely knows the room code can't register as the desktop, intercept
      // inbound chat messages, or forge replies. When no secret is configured
      // (local dev) registration is open — set CHAT_RELAY_SECRET in production.
      if (parsed?.type === CHAT_DEVICE_REGISTER_TYPE) {
        const secret = this.env.CHAT_RELAY_SECRET;
        const provided = (parsed.payload as { secret?: unknown }).secret;
        if (!secret || provided === secret) {
          sender.setState({ device: true });
        }
        return;
      }

      // Chat replies are never relayed to other sockets, and only an
      // authenticated device may resolve a waiting request — otherwise any peer
      // could inject attacker-controlled text back to the messaging platform.
      if (parsed?.type === CHAT_REPLY_TYPE) {
        if (!sender.state?.device) return;
        const reply = parseChatReply(parsed.payload);
        if (reply) {
          const resolve = this.pending.get(reply.correlationId);
          if (resolve) {
            this.pending.delete(reply.correlationId);
            resolve(reply.text);
          }
        }
        return;
      }
    }

    // Default behaviour: relay to all other connections in the room.
    for (const conn of this.getConnections()) {
      if (conn.id !== sender.id) {
        conn.send(message);
      }
    }
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const secret = this.env.CHAT_RELAY_SECRET;
    if (secret && request.headers.get("x-relay-secret") !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: { text?: unknown; conversation?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const text = typeof body.text === "string" ? body.text : "";
    if (!text) return Response.json({ error: "missing_text" }, { status: 400 });

    // Only a registered desktop can answer — a paired mobile client in the room
    // would receive (and ignore) chat messages, blocking until timeout. Send to
    // exactly one device: multiple hosts would each run the turn and emit a
    // chat_reply for the same correlationId (duplicate work; only the first
    // matches). One agent owns the session, so pick a single connection.
    const device = [...this.getConnections<ConnState>()].find((c) => c.state?.device);
    if (!device) {
      return Response.json({ error: "no_device" }, { status: 503 });
    }

    const correlationId = crypto.randomUUID();
    const envelope = encodeMessage("to_device", CHAT_MESSAGE_TYPE, {
      correlationId,
      text,
      conversation: (body.conversation ?? undefined) as Record<string, unknown> | undefined,
    });
    device.send(envelope);

    const replyPromise = new Promise<string>((resolve) => {
      this.pending.set(correlationId, resolve);
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), REPLY_TIMEOUT_MS);
    });

    const reply = await Promise.race([replyPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    this.pending.delete(correlationId);

    if (reply === null) return Response.json({ error: "timeout" }, { status: 504 });
    return Response.json({ text: reply });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Chat SDK gateway: platform webhooks land here and are bridged to the
    // desktop agent over the dispatch relay (same worker, same room). Only
    // configured platforms have a handler; others 404 rather than throw.
    const webhookMatch = pathname.match(/^\/api\/webhooks\/(slack|telegram|whatsapp|discord)$/);
    if (webhookMatch) {
      const platform = webhookMatch[1]!;
      const webhooks = getBot(env).webhooks as unknown as Record<
        string,
        ((request: Request) => Response | Promise<Response>) | undefined
      >;
      const handler = webhooks[platform];
      if (!handler) {
        return new Response(`${platform} adapter not configured`, { status: 404 });
      }
      return handler(request);
    }
    if (pathname === "/api/discord/gateway") {
      return discordGateway(request, env);
    }

    const routed = await routePartykitRequest(request, env as unknown as Record<string, unknown>);
    return routed ?? new Response("Not found", { status: 404 });
  },
};

/**
 * Discord delivers regular messages over a persistent Gateway WebSocket, which
 * Cloudflare Workers can't hold open. This route (meant to be hit by a
 * scheduler, guarded by CRON_SECRET) starts the adapter's gateway listener for
 * the invocation window — see docs for the Cloudflare caveat. Slack / Telegram
 * / WhatsApp are plain webhooks and need none of this.
 */
async function discordGateway(request: Request, env: Env): Promise<Response> {
  if (!env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  let discord: { startGatewayListener?: (webhookUrl: string) => Promise<Response> | Response } | undefined;
  try {
    discord = getBot(env).getAdapter("discord") as unknown as typeof discord;
  } catch {
    discord = undefined;
  }
  if (!discord || typeof discord.startGatewayListener !== "function") {
    return new Response("Discord gateway listener unavailable", { status: 501 });
  }
  const webhookUrl = `https://${new URL(request.url).host}/api/webhooks/discord`;
  return discord.startGatewayListener(webhookUrl);
}
