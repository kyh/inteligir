import { harnessIdSchema } from "@repo/domain/harness";
import { z } from "zod";

// the vendor's own answer about the sign-in in its shared store; unknown is a vendor that did not
// answer, never a sign-in the user may not need.
export const vendorAccountSchema = z.discriminatedUnion("state", [
  z.strictObject({
    email: z.string().nullable(),
    label: z.string().min(1),
    state: z.literal("signed-in"),
  }),
  z.strictObject({ state: z.literal("signed-out") }),
  z.strictObject({ detail: z.string(), state: z.literal("unknown") }),
]);
export type VendorAccount = z.infer<typeof vendorAccountSchema>;

// vendorApp: the vendor's own app on this Mac that shares the sign-in, so a sign-out here is its too.
const harnessNames = {
  displayName: z.string().min(1),
  id: harnessIdSchema,
  vendorApp: z.string().min(1),
};

// a runtime this copy of the app failed to ship has no vendor to ask.
export const harnessStatusSchema = z.discriminatedUnion("runtime", [
  z.strictObject({ ...harnessNames, account: vendorAccountSchema, runtime: z.literal("bundled") }),
  z.strictObject({ ...harnessNames, runtime: z.literal("missing") }),
]);
export type HarnessStatus = z.infer<typeof harnessStatusSchema>;

export type HarnessReadiness = "ready" | "signed-out" | "unavailable" | "unknown";

// a harness's status as one verdict, so the window's sign-in surfaces (the ⌘K need, the sign-in
// offer, the Settings cards) never re-derive it.
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
export const signingInSchema = z.strictObject({
  acceptsCode: z.boolean(),
  authUrl: z.url().nullable(),
  id: harnessIdSchema,
});
export type SigningIn = z.infer<typeof signingInSchema>;

export const agentsStatusResponseSchema = z.strictObject({
  // the harness a new thread starts on: the stored choice, else claude
  defaultId: harnessIdSchema,
  harnesses: z.array(harnessStatusSchema),
  signingIn: signingInSchema.nullable(),
});
export type AgentsStatusResponse = z.infer<typeof agentsStatusResponseSchema>;

export const agentsHarnessRequestSchema = z.strictObject({ id: harnessIdSchema });

// one line with no space in it: the vendor reads its stdin a line at a time, so a line break inside
// a code would hand it a second one.
export const SIGN_IN_CODE_MAX_LENGTH = 2048;
export const agentsSignInCodeRequestSchema = z.strictObject({
  code: z.string().trim().min(1).max(SIGN_IN_CODE_MAX_LENGTH).regex(/^\S+$/u),
  id: harnessIdSchema,
});

// incomplete: not the whole code the page shows, which the vendor would refuse where nobody sees
// it and go on waiting. A code that was sent answers on signIn, as any sign-in does.
export const agentsSignInCodeResponseSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("sent") }),
  z.strictObject({ outcome: z.literal("incomplete") }),
]);
export type AgentsSignInCodeResponse = z.infer<typeof agentsSignInCodeResponseSchema>;

// every answer carries the status after it, so a client replaces its copy rather than re-asking.
export const agentsSignInResponseSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("signed-in"), status: agentsStatusResponseSchema }),
  z.strictObject({ outcome: z.literal("cancelled"), status: agentsStatusResponseSchema }),
  z.strictObject({
    detail: z.string().min(1),
    outcome: z.literal("failed"),
    status: agentsStatusResponseSchema,
  }),
]);
export type AgentsSignInResponse = z.infer<typeof agentsSignInResponseSchema>;

export const agentsSignOutResponseSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("signed-out"), status: agentsStatusResponseSchema }),
  z.strictObject({
    detail: z.string().min(1),
    outcome: z.literal("failed"),
    status: agentsStatusResponseSchema,
  }),
]);
export type AgentsSignOutResponse = z.infer<typeof agentsSignOutResponseSchema>;
