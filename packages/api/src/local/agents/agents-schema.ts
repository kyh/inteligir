import { z } from "zod";

// the vendor's own answer about the sign-in in its shared store; unknown is a vendor that did not
// answer, never a sign-in the user may not need.
export const vendorAccountSchema = z.discriminatedUnion("state", [
  z
    .object({
      email: z.string().nullable(),
      label: z.string().min(1),
      state: z.literal("signed-in"),
    })
    .strict(),
  z.object({ state: z.literal("signed-out") }).strict(),
  z.object({ detail: z.string(), state: z.literal("unknown") }).strict(),
]);
export type VendorAccount = z.infer<typeof vendorAccountSchema>;

const harnessNames = { displayName: z.string().min(1), id: z.string().min(1) };

// a runtime this copy of the app failed to ship has no vendor to ask.
export const harnessStatusSchema = z.discriminatedUnion("runtime", [
  z
    .object({ ...harnessNames, account: vendorAccountSchema, runtime: z.literal("bundled") })
    .strict(),
  z.object({ ...harnessNames, runtime: z.literal("missing") }).strict(),
]);
export type HarnessStatus = z.infer<typeof harnessStatusSchema>;

export type HarnessReadiness = "ready" | "signed-out" | "unavailable" | "unknown";

// the one verdict the CLI and Settings both draw from a harness's status.
export const harnessReadiness = (status: HarnessStatus): HarnessReadiness => {
  if (status.runtime === "missing") {
    return "unavailable";
  }
  switch (status.account.state) {
    case "signed-in": {
      return "ready";
    }
    case "signed-out": {
      return "signed-out";
    }
    case "unknown": {
      return "unknown";
    }
    // no default
  }
};

export const agentsStatusResponseSchema = z
  .object({
    // the harness a new thread starts on: the stored choice, else claude
    defaultId: z.string().min(1),
    harnesses: z.array(harnessStatusSchema),
  })
  .strict();
export type AgentsStatusResponse = z.infer<typeof agentsStatusResponseSchema>;

export const agentsSetDefaultRequestSchema = z.object({ id: z.string().min(1) }).strict();
export type AgentsSetDefaultRequest = z.infer<typeof agentsSetDefaultRequestSchema>;
