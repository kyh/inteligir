import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for broadcasting dispatch events.
 * Uses the service role key so it can broadcast without RLS restrictions.
 */
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
);

/**
 * Cache of active channels keyed by device ID.
 * Channels are reused across calls to avoid leaking RealtimeChannel objects.
 */
const channels = new Map<string, RealtimeChannel>();

function getChannel(deviceId: string): RealtimeChannel {
  let ch = channels.get(deviceId);
  if (!ch) {
    ch = supabaseAdmin.channel(`dispatch:${deviceId}`);
    ch.subscribe();
    channels.set(deviceId, ch);
  }
  return ch;
}

/**
 * Broadcast a dispatch message to a device channel.
 * Both mobile and desktop subscribe to `dispatch:{deviceId}`.
 */
export async function broadcastDispatchEvent(
  deviceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ch = getChannel(deviceId);
  await ch.send({
    type: "broadcast",
    event,
    payload,
  });
}
