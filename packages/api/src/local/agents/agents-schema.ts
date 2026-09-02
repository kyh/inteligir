import { z } from "zod";

export const harnessProbeSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    cliPath: z.string().nullable(),
    // unknown: the only probe is one this platform cannot read without prompting (a keychain off-macos)
    credentials: z.enum(["present", "absent", "unknown"]),
    loginCommand: z.string().min(1),
  })
  .strict();
export type HarnessProbe = z.infer<typeof harnessProbeSchema>;

export const agentsStatusResponseSchema = z
  .object({ harnesses: z.array(harnessProbeSchema) })
  .strict();
export type AgentsStatusResponse = z.infer<typeof agentsStatusResponseSchema>;
