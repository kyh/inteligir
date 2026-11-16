// Whether a page's request is from someone signed in, which the site's guards ask as the Worker
// renders the page (apps/web/src/lib/session-guard.ts): Better Auth read in this isolate, since a
// fetch of this zone's own routes skips Workers. A read that failed is logged and answers false:
// all a guard does with true is skip a form, so a fault draws the form.

import { logUnhandled } from "../log";
import { readSession } from "./auth";

export const signedInFor =
  (env: Env, ctx: ExecutionContext, request: Request) => async (): Promise<boolean> => {
    try {
      return (await readSession(env, ctx, request)) !== null;
    } catch (error) {
      logUnhandled(request, error);
      return false;
    }
  };
