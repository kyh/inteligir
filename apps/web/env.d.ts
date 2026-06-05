interface CloudflareEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  PRODUCTION_URL: string;

  // --- Chat gateway: bridge to the desktop agent over the party relay ---
  /** Party host (no scheme), e.g. "inteligir-party.<acct>.workers.dev" or
   * "localhost:8787" in dev. */
  CHAT_RELAY_PARTY_HOST?: string;
  /** Desktop dispatch room code to relay into (shown in the desktop app). */
  CHAT_RELAY_ROOM?: string;
  /** Shared secret echoed to the party room on inbound POSTs. */
  CHAT_RELAY_SECRET?: string;
  /** Bot display name across adapters. Defaults to "inteligir". */
  CHAT_BOT_USERNAME?: string;

  // --- Per-platform adapter credentials (auto-detected by the Chat SDK) ---
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
}

declare module "cloudflare:workers" {
  const env: CloudflareEnv;
}
