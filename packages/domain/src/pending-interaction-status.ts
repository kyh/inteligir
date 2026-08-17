// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

/**
 * An interaction row's lifecycle. Both spellings live here because both sides
 * need a different one: the drizzle column takes the tuple, the wire schema
 * takes the enum, and a status added to only one of them is a runtime
 * ZodError on a row the store was happy to write.
 */
export const pendingInteractionStatusValues = [
  "pending",
  "resolving",
  "resolved",
  "interrupted",
] as const;
export const pendingInteractionStatusSchema = z.enum(pendingInteractionStatusValues);
export type PendingInteractionStatus = z.infer<typeof pendingInteractionStatusSchema>;
