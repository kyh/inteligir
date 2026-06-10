import { createDiscordAdapter, type DiscordAdapter } from "@chat-adapter/discord";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  Chat,
  type Adapter,
  type Lock,
  type Message,
  type QueueEntry,
  type StateAdapter,
  type Thread,
} from "chat";
import { getServerByName } from "partyserver";
import type { ChatConversation } from "@repo/dispatch/protocol";

import type { Env } from "./env";
import { DEDUPE_INSTANCE_NAME } from "./housekeeping";

// ---------------------------------------------------------------------------
// Chat SDK gateway — hosted in the relay Worker so the public webhook endpoint
// and the desktop relay live in one place (no extra service / inter-service
// hop). Each adapter normalizes its platform's webhooks into the same
// Thread/Message shape; a single handler relays the message to the desktop
// agent through this Worker's Durable Object and posts the reply back.
//
// SINGLE-TENANT BY DESIGN (v1): one CHAT_RELAY_ROOM + CHAT_RELAY_SECRET per
// deployed Worker — the gateway serves exactly the owner's desktop. See
// env.ts for the full note.
// ---------------------------------------------------------------------------

const FALLBACK = "Inteligir is offline right now — please try again in a moment.";

/** TTL used if the SDK ever omits one (it defaults to 5 minutes itself). */
const DEFAULT_DEDUPE_TTL_MS = 300_000;

/**
 * StateAdapter with cross-isolate webhook dedup.
 *
 * `setIfNotExists` is the Chat SDK's dedup primitive (one
 * `dedupe:<adapter>:<messageId>` check per inbound webhook). Workers run many
 * isolates, so a per-isolate memory store misses platform retries that land
 * on a cold isolate — each retry would start a duplicate agent turn. That one
 * primitive is routed to a dedicated Durable Object instance (DO storage,
 * alarm-swept TTLs — see DispatchServer.dedupeSetIfNotExists), falling back
 * to memory only if the DO call fails: better to risk a duplicate turn than
 * to drop a message.
 *
 * Locks / queues / subscriptions stay per-isolate (memory): cross-isolate
 * concurrency control is a known, accepted gap for the single-tenant v1
 * gateway (one desktop, low traffic).
 */
class DurableDedupState implements StateAdapter {
  private readonly memory = createMemoryState();
  private env: Env | null = null;

  /** Refresh the env binding (bindings are per-invocation; this instance
   * outlives any single request). */
  bindEnv(env: Env): void {
    this.env = env;
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    if (this.env !== null) {
      try {
        const stub = await getServerByName(this.env.DispatchServer, DEDUPE_INSTANCE_NAME);
        return await stub.dedupeSetIfNotExists(key, ttlMs ?? DEFAULT_DEDUPE_TTL_MS);
      } catch (err) {
        console.error("[chat] durable dedup unavailable, falling back to memory:", err);
      }
    }
    return this.memory.setIfNotExists(key, value, ttlMs);
  }

  // Everything below delegates to the in-memory adapter unchanged.
  connect(): Promise<void> {
    return this.memory.connect();
  }
  disconnect(): Promise<void> {
    return this.memory.disconnect();
  }
  subscribe(threadId: string): Promise<void> {
    return this.memory.subscribe(threadId);
  }
  unsubscribe(threadId: string): Promise<void> {
    return this.memory.unsubscribe(threadId);
  }
  isSubscribed(threadId: string): Promise<boolean> {
    return this.memory.isSubscribed(threadId);
  }
  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    return this.memory.acquireLock(threadId, ttlMs);
  }
  forceReleaseLock(threadId: string): Promise<void> {
    return this.memory.forceReleaseLock(threadId);
  }
  releaseLock(lock: Lock): Promise<void> {
    return this.memory.releaseLock(lock);
  }
  extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    return this.memory.extendLock(lock, ttlMs);
  }
  get<T = unknown>(key: string): Promise<T | null> {
    return this.memory.get<T>(key);
  }
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    return this.memory.set(key, value, ttlMs);
  }
  delete(key: string): Promise<void> {
    return this.memory.delete(key);
  }
  appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    return this.memory.appendToList(key, value, options);
  }
  getList<T = unknown>(key: string): Promise<T[]> {
    return this.memory.getList<T>(key);
  }
  enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    return this.memory.enqueue(threadId, entry, maxSize);
  }
  dequeue(threadId: string): Promise<QueueEntry | null> {
    return this.memory.dequeue(threadId);
  }
  queueDepth(threadId: string): Promise<number> {
    return this.memory.queueDepth(threadId);
  }
}

let cached: Chat | null = null;
let cachedKey: string | null = null;
let cachedDiscord: DiscordAdapter | null = null;
// Persist dedup/lock state across bot rebuilds. Rebuilding the bot on a config
// change must NOT drop the processed-event store, or platform retries would be
// reprocessed. The state outlives any single `Chat`.
let sharedState: DurableDedupState | null = null;

/** Signature of the env values that shape the bot and its relay handlers. The
 * bot is cached per isolate; if these ever differ from the cached snapshot
 * (e.g. a rotated secret seen by a warm isolate) we rebuild instead of serving
 * stale credentials. */
function configKey(env: Env): string {
  return JSON.stringify([
    env.CHAT_BOT_USERNAME,
    env.SLACK_BOT_TOKEN,
    env.SLACK_SIGNING_SECRET,
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
    env.WHATSAPP_ACCESS_TOKEN,
    env.WHATSAPP_APP_SECRET,
    env.WHATSAPP_PHONE_NUMBER_ID,
    env.WHATSAPP_VERIFY_TOKEN,
    env.DISCORD_BOT_TOKEN,
    env.DISCORD_PUBLIC_KEY,
    env.DISCORD_APPLICATION_ID,
    env.CHAT_RELAY_SECRET,
    env.CHAT_RELAY_ROOM,
  ]);
}

/**
 * Bridge for an upstream types gap: every `@chat-adapter/*` class exposes
 * `get botUserId(): string | undefined`, but chat's `Adapter` declares it as
 * an optional `string` — incompatible under `exactOptionalPropertyTypes`
 * until upstream compiles with that flag. The parameter type pins everything
 * *except* botUserId to the real `Adapter` shape, so this can't silently
 * launder an arbitrary object.
 */
function asAdapter(
  adapter: Omit<Adapter, "botUserId"> & { readonly botUserId?: string | undefined },
): Adapter {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- upstream botUserId gap, see doc above
  return adapter as Adapter;
}

function create(env: Env, state: DurableDedupState): Chat {
  const discord =
    env.DISCORD_BOT_TOKEN && env.DISCORD_PUBLIC_KEY && env.DISCORD_APPLICATION_ID
      ? createDiscordAdapter({
          botToken: env.DISCORD_BOT_TOKEN,
          publicKey: env.DISCORD_PUBLIC_KEY,
          applicationId: env.DISCORD_APPLICATION_ID,
        })
      : null;
  cachedDiscord = discord;

  const bot = new Chat({
    userName: env.CHAT_BOT_USERNAME || "inteligir",
    // Register only platforms that are actually configured — a missing
    // credential for one platform must not break the others' webhook routes.
    adapters: {
      ...(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET
        ? {
            slack: asAdapter(
              createSlackAdapter({
                botToken: env.SLACK_BOT_TOKEN,
                signingSecret: env.SLACK_SIGNING_SECRET,
              }),
            ),
          }
        : {}),
      ...(env.TELEGRAM_BOT_TOKEN
        ? {
            telegram: asAdapter(
              createTelegramAdapter({
                botToken: env.TELEGRAM_BOT_TOKEN,
                ...(env.TELEGRAM_WEBHOOK_SECRET_TOKEN === undefined
                  ? {}
                  : { secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN }),
                mode: "webhook",
              }),
            ),
          }
        : {}),
      ...(env.WHATSAPP_ACCESS_TOKEN &&
      env.WHATSAPP_APP_SECRET &&
      env.WHATSAPP_PHONE_NUMBER_ID &&
      env.WHATSAPP_VERIFY_TOKEN
        ? {
            whatsapp: asAdapter(
              createWhatsAppAdapter({
                accessToken: env.WHATSAPP_ACCESS_TOKEN,
                appSecret: env.WHATSAPP_APP_SECRET,
                phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
                verifyToken: env.WHATSAPP_VERIFY_TOKEN,
              }),
            ),
          }
        : {}),
      ...(discord ? { discord: asAdapter(discord) } : {}),
    },
    state,
  });

  const handle = makeHandler(env);
  bot.onDirectMessage(handle);
  bot.onNewMention(handle);
  bot.onSubscribedMessage(handle);
  return bot;
}

/** Lazily constructed and cached per isolate, rebuilt only if the relevant env
 * signature changes (dedup state is preserved across rebuilds). */
export function getBot(env: Env): Chat {
  sharedState ??= new DurableDedupState();
  sharedState.bindEnv(env);
  const key = configKey(env);
  if (!cached || key !== cachedKey) {
    cached = create(env, sharedState);
    cachedKey = key;
  }
  return cached;
}

/** The registered Discord adapter instance (for the gateway-listener route),
 * or null when Discord isn't configured. */
export function getDiscordAdapter(env: Env): DiscordAdapter | null {
  getBot(env); // ensure the cache matches this env
  return cachedDiscord;
}

function makeHandler(env: Env) {
  return async (thread: Thread, message: Message): Promise<void> => {
    if (message.author.isMe) return;
    const text = message.text.trim();
    if (!text) return;

    await thread.startTyping().catch(() => {});

    const reply = await relayToDesktop(env, {
      text,
      conversation: {
        platform: thread.adapter.name,
        channelId: thread.channelId,
        threadId: thread.id,
        isDM: thread.isDM,
        userId: message.author.userId,
        userName: message.author.userName,
      },
    });

    await thread.post(reply ?? FALLBACK);
  };
}

/** Shape of the relay DO's success response, validated at the boundary. */
const RelayResponseSchema = Type.Object({ text: Type.String() });

/**
 * Relay one message to the desktop agent via this Worker's Durable Object and
 * wait for the reply. The DO holds the desktop's WebSocket and correlates the
 * request to the matching `chat_reply`. Returns null when not configured, the
 * desktop is offline, or the turn times out.
 */
async function relayToDesktop(
  env: Env,
  input: { text: string; conversation?: ChatConversation },
): Promise<string | null> {
  const room = env.CHAT_RELAY_ROOM;
  if (!room) {
    console.error("[chat] CHAT_RELAY_ROOM not configured");
    return null;
  }

  try {
    const stub = await getServerByName(env.DispatchServer, room);
    const res = await stub.fetch("https://dispatch.internal/relay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": env.CHAT_RELAY_SECRET ?? "",
      },
      body: JSON.stringify({ text: input.text, conversation: input.conversation }),
    });
    if (!res.ok) {
      console.error(`[chat] relay failed: ${res.status}`);
      return null;
    }
    const data: unknown = await res.json();
    if (!Value.Check(RelayResponseSchema, data)) {
      console.error("[chat] relay returned an unexpected body");
      return null;
    }
    return data.text;
  } catch (err) {
    console.error("[chat] relay error:", err);
    return null;
  }
}
