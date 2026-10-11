import { z } from "zod";

import { parseVaultPath } from "./vault-path";

// the parse must be the identity: these values address files verbatim on both ends of a wire (a
// git tree, the phone's store), so a path the grammar would normalize is refused rather than
// silently renamed
export const normalVaultPathSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseVaultPath(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
  } else if (parsed.path !== value) {
    ctx.addIssue({
      code: "custom",
      message: "path must be already normal — no empty segments or trailing slash",
    });
  }
});
