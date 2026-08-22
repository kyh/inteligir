// Agent harness detection (issue #588): the facts Settings shows per harness —
// vendor CLI presence, credential presence, and the login command. READ-ONLY:
// the ACP adapters ship with the app, and the vendor CLIs are the user's, so
// there is deliberately nothing here that installs or mutates.

import { z } from "zod";
import { defineRoute, jsonResponse, noRequest } from "@repo/typed-routes/route-descriptor";

export const harnessProbeSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    /** Absolute path of the vendor CLI on PATH, or null when absent. */
    cliPath: z.string().nullable(),
    /** "unknown" when the only probe is one this platform cannot read
     *  without prompting (a keychain off-macOS). */
    credentials: z.enum(["present", "absent", "unknown"]),
    loginCommand: z.string().min(1),
  })
  .strict();
export type HarnessProbe = z.infer<typeof harnessProbeSchema>;

export const agentsStatusResponseSchema = z
  .object({ harnesses: z.array(harnessProbeSchema) })
  .strict();
export type AgentsStatusResponse = z.infer<typeof agentsStatusResponseSchema>;

export const agentsRoutes = {
  status: defineRoute({
    path: "/agents/status",
    method: "get",
    request: noRequest(),
    response: jsonResponse<AgentsStatusResponse>(),
  }),
};
