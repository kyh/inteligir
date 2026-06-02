import { z } from "zod";

export const DispatchStateSchema = z.object({
  status: z.enum(["idle", "awaiting_pair", "connected", "reconnecting", "error"]),
  roomCode: z.string().nullable(),
  error: z.string().nullable(),
});

export type DispatchState = z.infer<typeof DispatchStateSchema>;

export const DISPATCH_INITIAL_STATE: DispatchState = {
  status: "idle",
  roomCode: null,
  error: null,
};
