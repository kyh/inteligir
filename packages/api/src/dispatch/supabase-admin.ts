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
 * Cache of subscribed channels keyed by device ID.
 * Channels are reused across calls to avoid leaking RealtimeChannel objects.
 */
const channels = new Map<string, RealtimeChannel>();
const subscribed = new Map<string, Promise<void>>();

function getChannel(deviceId: string): { channel: RealtimeChannel; ready: Promise<void> } {
  let ch = channels.get(deviceId);
  let ready = subscribed.get(deviceId);

  if (!ch || !ready) {
    ch = supabaseAdmin.channel(`dispatch:${deviceId}`);
    channels.set(deviceId, ch);

    ready = new Promise<void>((resolve, reject) => {
      ch!.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status !== "SUBSCRIBED") {
          // CHANNEL_ERROR, TIMED_OUT, CLOSED — clear cache so the
          // next call creates a fresh channel instead of hanging.
          channels.delete(deviceId);
          subscribed.delete(deviceId);
          supabaseAdmin.removeChannel(ch!);
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
