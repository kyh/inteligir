import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for broadcasting dispatch events.
 * Uses the service role key so it can broadcast without RLS restrictions.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
);

/**
 * Broadcast a dispatch message to a device channel.
 * Both mobile and desktop subscribe to `dispatch:{deviceId}`.
 */
export async function broadcastDispatchEvent(
  deviceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin.channel(`dispatch:${deviceId}`).send({
    type: "broadcast",
    event,
    payload,
  });
}
