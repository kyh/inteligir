import { Chat, type Message, type Thread } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { getServerByName } from "partyserver";
import type { ChatConversation } from "@repo/dispatch";

import type { Env } from "./env";

// ---------------------------------------------------------------------------
// Chat SDK gateway — hosted in the party worker so the public webhook endpoint
// and the desktop relay live in one place (no extra service / inter-service
// hop). Each adapter normalizes its platform's webhooks into the same
// Thread/Message shape; a single handler relays the message to the desktop
// agent through this worker's Durable Object and posts the reply back.
// ---------------------------------------------------------------------------

const FALLBACK = "Inteligir is offline right now — please try again in a moment.";

let cached: Chat | null = null;
let cachedKey: string | null = null;
// Persist webhook-dedup state across rebuilds. Rebuilding the bot on a config
// change must NOT drop the Chat SDK's processed-event store, or Slack's 3s
// retries (etc.) would be reprocessed. The state outlives any single `Chat`.
let sharedState: ReturnType<typeof createMemoryState> | null = null;

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

function create(env: Env): Chat {
  sharedState ??= createMemoryState();
  const bot = new Chat({
    userName: env.CHAT_BOT_USERNAME || "inteligir",
    // Register only platforms that are actually configured — a missing
    // credential for one platform must not break the others' webhook routes.
    adapters: {
      ...(env.SLACK_BOT_TOKEN && env.SLACK_SIGNING_SECRET
        ? {
            slack: createSlackAdapter({
              botToken: env.SLACK_BOT_TOKEN,
              signingSecret: env.SLACK_SIGNING_SECRET,
            }),
          }
        : {}),
      ...(env.TELEGRAM_BOT_TOKEN
        ? {
            telegram: createTelegramAdapter({
              botToken: env.TELEGRAM_BOT_TOKEN,
              secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
              mode: "webhook",
            }),
          }
        : {}),
      ...(env.WHATSAPP_ACCESS_TOKEN &&
      env.WHATSAPP_APP_SECRET &&
      env.WHATSAPP_PHONE_NUMBER_ID &&
      env.WHATSAPP_VERIFY_TOKEN
        ? {
            whatsapp: createWhatsAppAdapter({
              accessToken: env.WHATSAPP_ACCESS_TOKEN,
              appSecret: env.WHATSAPP_APP_SECRET,
              phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
              verifyToken: env.WHATSAPP_VERIFY_TOKEN,
            }),
          }
        : {}),
      ...(env.DISCORD_BOT_TOKEN && env.DISCORD_PUBLIC_KEY && env.DISCORD_APPLICATION_ID
        ? {
            discord: createDiscordAdapter({
              botToken: env.DISCORD_BOT_TOKEN,
              publicKey: env.DISCORD_PUBLIC_KEY,
              applicationId: env.DISCORD_APPLICATION_ID,
            }),
          }
        : {}),
    },
    state: sharedState,
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
  const key = configKey(env);
  if (!cached || key !== cachedKey) {
    cached = create(env);
    cachedKey = key;
  }
  return cached;
}

function makeHandler(env: Env) {
  return async (thread: Thread, message: Message): Promise<void> => {
    if (message.author.isMe) return;
    const text = message.text?.trim();
    if (!text) return;

    const loose = thread as unknown as { id?: string; channelId?: string; isDM?: boolean };
    const platform = (message as unknown as { adapterName?: string }).adapterName ?? "chat";

    await thread.startTyping().catch(() => {});

    const reply = await relayToDesktop(env, {
      text,
      conversation: {
        platform,
        channelId: loose.channelId,
        threadId: loose.id,
        isDM: loose.isDM,
        userId: message.author.userId,
        userName: message.author.userName,
      },
    });

    await thread.post(reply ?? FALLBACK);
  };
}

/**
 * Relay one message to the desktop agent via this worker's Durable Object and
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
    const data = (await res.json()) as { text?: string };
    return data.text ?? null;
  } catch (err) {
    console.error("[chat] relay error:", err);
    return null;
  }
}
