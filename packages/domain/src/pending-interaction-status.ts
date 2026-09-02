// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

// the drizzle column takes the tuple and the wire schema the enum; one list so a status cannot
// exist on only one side.
export const pendingInteractionStatusValues = [
  "pending",
  "resolving",
  "resolved",
  "interrupted",
] as const;
export const pendingInteractionStatusSchema = z.enum(pendingInteractionStatusValues);
export type PendingInteractionStatus = z.infer<typeof pendingInteractionStatusSchema>;
