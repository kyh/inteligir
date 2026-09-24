import { z } from "zod";

export const harnessProbeSchema = z
  .object({
    cliPath: z.string().nullable(),
    // unknown: the only probe is one this platform cannot read without prompting (a keychain off-macos)
    credentials: z.enum(["present", "absent", "unknown"]),
    displayName: z.string().min(1),
    id: z.string().min(1),
    loginCommand: z.string().min(1),
  })
  .strict();
export type HarnessProbe = z.infer<typeof harnessProbeSchema>;

export type HarnessReadiness = "not-installed" | "ready" | "needs-sign-in" | "unknown";

// the one verdict the CLI and Settings both draw from the probe's facts; an unreadable credential
// store is "unknown", never a sign-in the user may not need.
export const harnessReadiness = (probe: HarnessProbe): HarnessReadiness => {
  if (probe.cliPath === null) {
    return "not-installed";
  }
  switch (probe.credentials) {
    case "present": {
      return "ready";
    }
    case "absent": {
      return "needs-sign-in";
    }
    case "unknown": {
      return "unknown";
    }
    // no default
  }
};

export const agentsStatusResponseSchema = z
  .object({
    // the harness a new thread starts on: the stored choice, else the one on PATH
    defaultId: z.string().min(1),
    harnesses: z.array(harnessProbeSchema),
  })
  .strict();
export type AgentsStatusResponse = z.infer<typeof agentsStatusResponseSchema>;

export const agentsSetDefaultRequestSchema = z.object({ id: z.string().min(1) }).strict();
export type AgentsSetDefaultRequest = z.infer<typeof agentsSetDefaultRequestSchema>;
