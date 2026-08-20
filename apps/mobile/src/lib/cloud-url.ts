import Constants from "expo-constants";
import { z } from "zod";

/** The one field this app reads out of `app.config`'s free-form `extra`. Parsed
 *  at the boundary rather than typeof-sniffed — extra is untyped config. */
const extraSchema = z.object({ cloudUrl: z.string().min(1) });

// The cloud Worker origin the sync client and pairing talk to. There is no other
// backend — the phone is a sync-only client of `@repo/cloud-contract`.

/** The wrangler dev port the cloud Worker serves on locally. */
const DEV_CLOUD_PORT = 8787;

/**
 * Resolve the cloud origin:
 *   1. `EXPO_PUBLIC_CLOUD_URL` (baked at build / set in the shell)
 *   2. `app.config` `extra.cloudUrl`
 *   3. dev fallback — the Metro host machine on the wrangler port, so a device on
 *      the same LAN reaches `wrangler dev` on your laptop.
 *
 * Throws when none resolve (a real build with no origin configured), surfacing
 * the misconfiguration rather than silently pointing nowhere.
 */
export function getCloudUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CLOUD_URL;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  const extra = extraSchema.safeParse(Constants.expoConfig?.extra);
  if (extra.success) return extra.data.cloudUrl;

  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host === undefined || host === "") {
    throw new Error("cloud URL unset — set EXPO_PUBLIC_CLOUD_URL or app.config extra.cloudUrl");
  }
  return `http://${host}:${DEV_CLOUD_PORT}`;
}
