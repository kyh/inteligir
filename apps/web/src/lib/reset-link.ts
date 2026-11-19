import { z } from "zod";

export type ResetView =
  | { readonly kind: "form"; readonly token: string }
  | { readonly kind: "done" }
  | { readonly kind: "dead" };

const liveLinkSchema = z.object({ error: z.never().optional(), token: z.string().min(1) });

export const resetViewOf = (search: Record<string, string | string[] | undefined>) => {
  const live = liveLinkSchema.safeParse(search);

  return (
    live.success ? { kind: "form", token: live.data.token } : { kind: "dead" }
  ) satisfies ResetView;
};
