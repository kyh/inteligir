import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { DispatchServer } from "./server";

// ---------------------------------------------------------------------------
// Worker environment.
//
// Every var is an optional string set via `wrangler secret put <NAME>`
// (`.dev.vars` locally; see .dev.vars.example for per-var docs). A missing
// value disables the feature it powers — it never loosens auth (fail closed).
//
// SINGLE-TENANCY (deliberate, v1): the external chat gateway serves exactly
// one desktop. One CHAT_RELAY_ROOM and one CHAT_RELAY_SECRET per deployed
// Worker — the Worker is owner-operated, so "the configured room" and "the
// owner's desktop" are the same thing. Multi-tenant chat would need per-user
// provisioning of room + secret; revisit only if chat interfaces become a
// product feature. The WebSocket relay itself is multi-room (any number of
// pairing credentials), only the chat gateway is pinned to one room.
// ---------------------------------------------------------------------------

const EnvVarsSchema = Type.Object({
  // --- Chat gateway (DO ↔ external messaging platforms) ---
  /** Authenticates the gateway's POST to the relay DO (`x-relay-secret`
   * header). Unset ⇒ the DO refuses every relay POST ⇒ inbound chat is off. */
  CHAT_RELAY_SECRET: Type.Optional(Type.String()),
  /** roomId of the desktop's current pairing credential. Rotating the pairing
   * credential changes the roomId — this var must be updated to follow it. */
  CHAT_RELAY_ROOM: Type.Optional(Type.String()),
  /** Bot display name across adapters. Defaults to "inteligir". */
  CHAT_BOT_USERNAME: Type.Optional(Type.String()),

  // --- Per-platform adapter credentials (unset ⇒ adapter not registered) ---
  SLACK_BOT_TOKEN: Type.Optional(Type.String()),
  SLACK_SIGNING_SECRET: Type.Optional(Type.String()),
  TELEGRAM_BOT_TOKEN: Type.Optional(Type.String()),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: Type.Optional(Type.String()),
  WHATSAPP_ACCESS_TOKEN: Type.Optional(Type.String()),
  WHATSAPP_APP_SECRET: Type.Optional(Type.String()),
  WHATSAPP_PHONE_NUMBER_ID: Type.Optional(Type.String()),
  WHATSAPP_VERIFY_TOKEN: Type.Optional(Type.String()),
  DISCORD_BOT_TOKEN: Type.Optional(Type.String()),
  DISCORD_PUBLIC_KEY: Type.Optional(Type.String()),
  DISCORD_APPLICATION_ID: Type.Optional(Type.String()),
  /** Bearer secret guarding the Discord gateway-listener route. */
  CRON_SECRET: Type.Optional(Type.String()),
});

type EnvVars = Static<typeof EnvVarsSchema>;

/** Bindings, vars and secrets available to the Worker + Durable Object. */
export type Env = EnvVars & {
  /** DO namespace backing relay rooms and the webhook-dedup instance. */
  DispatchServer: DurableObjectNamespace<DispatchServer>;
};

/** Boundary check at fetch entry: every configured var must actually be a
 * string (catches a non-secret binding accidentally claiming a var's name).
 * Extra bindings (the DO namespace) are tolerated by the schema. */
export function hasValidEnvVars(env: Env): boolean {
  return Value.Check(EnvVarsSchema, env);
}
