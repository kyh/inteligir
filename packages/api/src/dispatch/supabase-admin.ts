import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazy-initialized server-side Supabase client for broadcasting dispatch events.
 * Uses the service role key so it can broadcast without RLS restrictions.
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

const channels = new Map<string, RealtimeChannel>();
const subscribed = new Map<string, Promise<void>>();

function evictChannel(deviceId: string): void {
  const ch = channels.get(deviceId);
  if (ch) {
    getSupabaseAdmin().removeChannel(ch);
    channels.delete(deviceId);
  }
  subscribed.delete(deviceId);
}

function getChannel(deviceId: string): { channel: RealtimeChannel; ready: Promise<void> } {
  let ch = channels.get(deviceId);
  let ready = subscribed.get(deviceId);

  if (!ch || !ready) {
    const admin = getSupabaseAdmin();
    ch = admin.channel(`dispatch:${deviceId}`);
    channels.set(deviceId, ch);

    ready = new Promise<void>((resolve, reject) => {
      let resolved = false;
      ch!.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          resolved = true;
          resolve();
        } else {
          // Clean up on any failure — both pre- and post-subscribe.
          // Post-subscribe cleanup lets the next call create a fresh channel.
          evictChannel(deviceId);
          if (!resolved) {
            reject(new Error(`Channel subscription failed: ${status}`));
          }
        }
      });
    });
    subscribed.set(deviceId, ready);
  }

  return { channel: ch, ready };
}

/**
 * Broadcast a dispatch message to a device channel.
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

/**
 * Clean up a device's cached channel (call on device deletion).
 */
export function removeDeviceChannel(deviceId: string): void {
  evictChannel(deviceId);
}
