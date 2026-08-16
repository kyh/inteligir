// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the plain JSON-RPC envelope; the sdk/message, thread/identity,
// context-window and error envelopes belonged to the bridge-process adapters
// that are not carried.

import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

export const jsonRpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: recordSchema.optional(),
  })
  .passthrough();
