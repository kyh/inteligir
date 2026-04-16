import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazy-initialized server-side Supabase client for broadcasting dispatch events.
 * Uses the service role key so it can broadcast without RLS restrictions.
 * Lazy init avoids "supabaseUrl is required" errors during Next.js build.
 */
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    );
  }
  return _supabaseAdmin;
}

/**
 * Cache of subscribed channels keyed by device ID.
 * Channels are reused across calls to avoid leaking RealtimeChannel objects.
 */
const channels = new Map<string, RealtimeChannel>();
const subscribed = new Map<string, Promise<void>>();

function getChannel(deviceId: string): { channel: RealtimeChannel; ready: Promise<void> } {
  let ch = channels.get(deviceId);
  let ready = subscribed.get(deviceId);

  if (!ch || !ready) {
    const admin = getSupabaseAdmin();
    ch = admin.channel(`dispatch:${deviceId}`);
    channels.set(deviceId, ch);

    let resolved = false;
    ready = new Promise<void>((resolve, reject) => {
      ch!.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          resolved = true;
          resolve();
        } else if (!resolved) {
          channels.delete(deviceId);
          subscribed.delete(deviceId);
          admin.removeChannel(ch!);
          reject(new Error(`Channel subscription failed: ${status}`));
        }
      });
    });
    subscribed.set(deviceId, ready);
  }

  return { channel: ch, ready };
}

/**
 * Broadcast a dispatch message to a device channel.
 * Both mobile and desktop subscribe to `dispatch:{deviceId}`.
 * Awaits the channel subscription before sending to ensure delivery.
 */
export async function broadcastDispatchEvent(
  deviceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { channel, ready } = getChannel(deviceId);
  await ready;
  await channel.send({
    type: "broadcast",
    event,
    payload,
  });
}
