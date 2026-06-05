import { Chat, type Message, type Thread } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";

import { getCloudflareEnv } from "@/lib/cloudflare";
import { relayToDesktop } from "@/server/chat/relay";

// ---------------------------------------------------------------------------
// Chat SDK gateway — the public webhook surface for external messaging
// interfaces. Each adapter normalizes its platform's webhooks into the same
// Thread/Message shape; a single handler relays the message to the desktop
// agent and posts the reply back through the live thread.
//
// Credentials are auto-detected from environment variables by each adapter
// factory (SLACK_BOT_TOKEN, TELEGRAM_BOT_TOKEN, WHATSAPP_*, DISCORD_*). On
// Cloudflare Workers these come from `[vars]`/secrets via nodejs_compat's
// populated `process.env`. An adapter with no credentials configured simply
// fails its own signature/verification step — it doesn't break the others.
// ---------------------------------------------------------------------------

const FALLBACK = "Inteligir is offline right now — please try again in a moment.";

let cached: ReturnType<typeof create> | null = null;

function create() {
  const env = getCloudflareEnv();
  const bot = new Chat({
    userName: env.CHAT_BOT_USERNAME || "inteligir",
    adapters: {
      slack: createSlackAdapter(),
      telegram: createTelegramAdapter({ mode: "webhook" }),
      whatsapp: createWhatsAppAdapter(),
      discord: createDiscordAdapter(),
    },
    state: createMemoryState(),
  });

  // Every routing path (DM, @-mention, subscribed thread) funnels into one
  // relay handler. We register all three so the bot answers whether it's
  // DMed, mentioned in a channel, or already following a thread.
  bot.onDirectMessage(handle);
  bot.onNewMention(handle);
  bot.onSubscribedMessage(handle);

  return bot;
}

/** Lazily constructed, cached for the lifetime of the isolate. */
export function getBot() {
  if (!cached) cached = create();
  return cached;
}

async function handle(thread: Thread, message: Message): Promise<void> {
  // Never respond to our own messages (defensive — the SDK already filters).
  if (message.author.isMe) return;

  const text = message.text?.trim();
  if (!text) return;

  // Best-effort context for desktop logging; the reply is posted via `thread`
  // regardless, so missing fields are harmless.
  const loose = thread as unknown as { id?: string; channelId?: string; isDM?: boolean };
  const platform = (message as unknown as { adapterName?: string }).adapterName ?? "chat";

  await thread.startTyping().catch(() => {});

  const reply = await relayToDesktop({
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
}
