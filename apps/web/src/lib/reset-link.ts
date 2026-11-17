import { z } from "zod";

// what the reset page draws: the form for a live link, or what became of it
export type ResetView =
  | { readonly kind: "form"; readonly token: string }
  | { readonly kind: "done" }
  | { readonly kind: "dead" };

// Better Auth's GET leg lands a live link on the page with ?token= and a spent or expired one with
// ?error=, beside the way back the request named; anything else is a link no reset can follow
const liveLinkSchema = z.object({ error: z.never().optional(), token: z.string().min(1) });

export const resetViewOf = (search: Record<string, string | string[] | undefined>): ResetView => {
  const live = liveLinkSchema.safeParse(search);
  return live.success ? { kind: "form", token: live.data.token } : { kind: "dead" };
};
