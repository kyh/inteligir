import { z } from "zod";

// ---------------------------------------------------------------------------
// Device registration (called by desktop, unauthenticated)
// ---------------------------------------------------------------------------

export const registerDeviceInput = z.object({
  name: z.string().min(1).max(100),
});

// ---------------------------------------------------------------------------
// Pairing (called by mobile — pairing code is the auth)
// ---------------------------------------------------------------------------

export const pairDeviceInput = z.object({
  code: z.string().length(6),
});

// ---------------------------------------------------------------------------
// Device-token auth (desktop)
// ---------------------------------------------------------------------------

export const deviceTokenInput = z.object({
  deviceToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Send message (mobile → device)
// ---------------------------------------------------------------------------

export const sendMessageInput = z.object({
  mobileToken: z.string().min(1),
  type: z.enum(["user_message", "steer", "interrupt"]),
  payload: z.record(z.string(), z.unknown()).default({}),
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
// Catch-up (fetch pending messages on reconnect)
// ---------------------------------------------------------------------------

export const catchUpInput = z.object({
  deviceToken: z.string().min(1),
});

export const mobileCatchUpInput = z.object({
  mobileToken: z.string().min(1),
});
