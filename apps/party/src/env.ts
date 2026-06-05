import type { DispatchServer } from "./server";

/** Bindings, vars and secrets available to the party worker + Durable Object. */
export type Env = {
  DispatchServer: DurableObjectNamespace<DispatchServer>;

  // --- Chat bridge ---
  /** Shared secret: the desktop presents it to register, and it gates the
   * internal relay call. Open registration when unset (local dev only). */
  CHAT_RELAY_SECRET?: string;
  /** Desktop dispatch room code the gateway relays into. */
  CHAT_RELAY_ROOM?: string;
  /** Bot display name across adapters. Defaults to "inteligir". */
  CHAT_BOT_USERNAME?: string;

  // --- Per-platform adapter credentials ---
  SLACK_BOT_TOKEN?: string;
  SLACK_SIGNING_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
  /** Bearer secret guarding the Discord gateway-listener route. */
  CRON_SECRET?: string;
};
