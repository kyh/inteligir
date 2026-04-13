import { z } from "zod";

// ---------------------------------------------------------------------------
// Device registration (called by desktop, unauthenticated)
// ---------------------------------------------------------------------------

export const registerDeviceInput = z.object({
  name: z.string().min(1).max(100),
});

// ---------------------------------------------------------------------------
// Pairing (called by mobile, authenticated)
// ---------------------------------------------------------------------------

export const pairDeviceInput = z.object({
  code: z.string().length(6),
});

// ---------------------------------------------------------------------------
// Heartbeat (called by desktop, device-token auth)
// ---------------------------------------------------------------------------

export const heartbeatInput = z.object({
  deviceToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Send message (mobile → device)
// ---------------------------------------------------------------------------

export const sendMessageInput = z.object({
  deviceId: z.string().uuid(),
  type: z.enum(["user_message", "steer", "interrupt"]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Poll messages (desktop polls for to_device, mobile polls for to_mobile)
// ---------------------------------------------------------------------------

export const pollMessagesInput = z.object({
  deviceToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Respond (desktop → mobile)
// ---------------------------------------------------------------------------

export const respondInput = z.object({
  deviceToken: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Poll responses (mobile polls for to_mobile messages)
// ---------------------------------------------------------------------------

export const pollResponsesInput = z.object({
  deviceId: z.string().uuid(),
});
