// A vault entry the page asks the OS to show or open: the request names it vault-relative,
// the shell resolves and checks it, and the answer says only whether the OS took it.

import { z } from "zod";

export const pathActionRequestSchema = z.strictObject({ path: z.string().min(1) });
