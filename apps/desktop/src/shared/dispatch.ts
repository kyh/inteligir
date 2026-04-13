// ---------------------------------------------------------------------------
// Dispatch types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

import { z } from "zod";

export const DispatchStateSchema = z.object({
  status: z.enum(["unregistered", "registering", "awaiting_pairing", "paired", "error"]),
  deviceId: z.string().nullable(),
  pairingCode: z.string().nullable(),
  pairingExpiresAt: z.string().nullable(),
  error: z.string().nullable(),
});

export type DispatchState = z.infer<typeof DispatchStateSchema>;

export const DISPATCH_INITIAL_STATE: DispatchState = {
  status: "unregistered",
  deviceId: null,
  pairingCode: null,
  pairingExpiresAt: null,
  error: null,
};

/** Persisted dispatch credentials (written to ~/.inteligir/dispatch.json) */
export const DispatchCredentialsSchema = z.object({
  deviceId: z.string(),
  token: z.string(),
});

export type DispatchCredentials = z.infer<typeof DispatchCredentialsSchema>;

/** Inbound message from mobile (received via polling) */
export type DispatchInboundMessage = {
  id: string;
  type: "user_message" | "steer" | "interrupt";
  payload: Record<string, unknown>;
  createdAt: string;
};
