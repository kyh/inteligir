import Constants from "expo-constants";

// ---------------------------------------------------------------------------
// The coordinator (Cloudflare Worker) origin the sync client + Better Auth talk
// to. There is no tRPC/API layer — sync is DIRECT over @repo/domain's HTTP wire
// contract — so this is the single backend origin.
// ---------------------------------------------------------------------------

/** The wrangler dev port the coordinator Worker serves on locally. */
const DEV_COORDINATOR_PORT = 8787;

/**
 * Resolve the coordinator origin:
 *   1. `EXPO_PUBLIC_COORDINATOR_URL` (baked at build / set in the shell)
 *   2. `app.config` `extra.coordinatorUrl`
 *   3. dev fallback — the Metro host machine on the wrangler port, so a device
 *      on the same LAN reaches `wrangler dev` running on your laptop.
 *
 * Throws when none resolve (a real build with no origin configured), surfacing
 * the misconfiguration rather than silently pointing nowhere.
 */
export function getCoordinatorUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_COORDINATOR_URL;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;

  const extra = Constants.expoConfig?.extra;
  const fromExtra =
    extra && typeof extra.coordinatorUrl === "string" ? extra.coordinatorUrl : undefined;
  if (fromExtra !== undefined && fromExtra !== "") return fromExtra;

  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host === undefined || host === "") {
    throw new Error(
      "coordinator URL unset — set EXPO_PUBLIC_COORDINATOR_URL or app.config extra.coordinatorUrl",
    );
  }
  return `http://${host}:${DEV_COORDINATOR_PORT}`;
}
