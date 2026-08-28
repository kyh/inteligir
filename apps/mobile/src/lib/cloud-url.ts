import Constants from "expo-constants";
import { z } from "zod";

/** The one field this app reads out of `app.config`'s free-form `extra`. Parsed
 *  at the boundary rather than typeof-sniffed — extra is untyped config. */
const extraSchema = z.object({ cloudUrl: z.string().min(1) });

// The cloud Worker origin the sync client and pairing talk to. There is no other
// backend — the phone is a sync-only client of `@repo/api/cloud`.

/**
 * Resolve the cloud origin:
 *   1. `EXPO_PUBLIC_CLOUD_URL` (baked at build / set in the shell)
 *   2. `app.config` `extra.cloudUrl`
 *
 * Throws when neither resolves, surfacing the misconfiguration rather than
 * silently pointing nowhere. There is deliberately no LAN-host fallback: the
 * Worker's dev server binds localhost, so a guessed origin on the Metro host
 * could never answer a phone anyway.
 */
export function getCloudUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CLOUD_URL;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  const extra = extraSchema.safeParse(Constants.expoConfig?.extra);
  if (extra.success) return extra.data.cloudUrl;

  throw new Error("cloud URL unset — set EXPO_PUBLIC_CLOUD_URL or app.config extra.cloudUrl");
}
