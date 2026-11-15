import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getSessionCookie } from "better-auth/cookies";

import { signedInLanding, signInHref } from "#lib/next-path";

import type { RequestContext } from "../request-context";

// A page for someone signed in, asked for with no session cookie, goes to sign in and back before
// the Worker serves any of it. The cookie alone, with no read of its session: that would spend a
// database read on every such document, and a cookie whose session ended is the page's to find.
export const requireSessionCookie = createMiddleware().server(async ({ next, request }) => {
  if (getSessionCookie(request) === null) {
    redirect({ href: signInHref(new URL(request.url)), throw: true });
  }
  return await next();
});

// Sign-in and sign-up skipped for someone already signed in, to where they were going. Asked of
// the Worker alone, as it renders the page: in the browser the guard also runs on each hover of a
// link to either form, where a read of the session is a request nobody made.
export const redirectWhenSignedIn = async ({
  search,
  serverContext,
}: {
  search: { next?: string };
  serverContext?: Pick<RequestContext, "signedIn">;
}): Promise<void> => {
  if ((await serverContext?.signedIn()) === true) {
    redirect({ href: signedInLanding(search.next), reloadDocument: true, throw: true });
  }
};
