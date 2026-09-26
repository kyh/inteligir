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

// vendorApp: the vendor's own app on this Mac that shares the sign-in, so a sign-out here is its too.
const harnessNames = {
  displayName: z.string().min(1),
  id: z.string().min(1),
  vendorApp: z.string().min(1),
};

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

// the one sign-in this server is running. authUrl is the address the vendor printed for a browser
// that did not open, null until it prints one (and always, for a vendor that prints none).
// acceptsCode: the sign-in also takes the code that address's page shows, through submitSignInCode.
export const signingInSchema = z
  .object({ acceptsCode: z.boolean(), authUrl: z.url().nullable(), id: z.string().min(1) })
  .strict();
export type SigningIn = z.infer<typeof signingInSchema>;

export const agentsStatusResponseSchema = z
  .object({
    // the harness a new thread starts on: the stored choice, else claude
    defaultId: z.string().min(1),
    harnesses: z.array(harnessStatusSchema),
    signingIn: signingInSchema.nullable(),
  })
  .strict();
export type AgentsStatusResponse = z.infer<typeof agentsStatusResponseSchema>;

export const agentsHarnessRequestSchema = z.object({ id: z.string().min(1) }).strict();

// one line with no space in it: the vendor reads its stdin a line at a time, so a line break inside
// a code would hand it a second one.
export const SIGN_IN_CODE_MAX_LENGTH = 2048;
export const agentsSignInCodeRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(SIGN_IN_CODE_MAX_LENGTH).regex(/^\S+$/u),
    id: z.string().min(1),
  })
  .strict();

// incomplete: not the whole code the page shows, which the vendor would refuse where nobody sees
// it and go on waiting. A code that was sent answers on signIn, as any sign-in does.
export const agentsSignInCodeResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("sent") }).strict(),
  z.object({ outcome: z.literal("incomplete") }).strict(),
]);
export type AgentsSignInCodeResponse = z.infer<typeof agentsSignInCodeResponseSchema>;

// every answer carries the status after it, so a client replaces its copy rather than re-asking.
export const agentsSignInResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("signed-in"), status: agentsStatusResponseSchema }).strict(),
  z.object({ outcome: z.literal("cancelled"), status: agentsStatusResponseSchema }).strict(),
  z
    .object({
      detail: z.string().min(1),
      outcome: z.literal("failed"),
      status: agentsStatusResponseSchema,
    })
    .strict(),
]);
export type AgentsSignInResponse = z.infer<typeof agentsSignInResponseSchema>;

export const agentsSignOutResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("signed-out"), status: agentsStatusResponseSchema }).strict(),
  z
    .object({
      detail: z.string().min(1),
      outcome: z.literal("failed"),
      status: agentsStatusResponseSchema,
    })
    .strict(),
]);
export type AgentsSignOutResponse = z.infer<typeof agentsSignOutResponseSchema>;
