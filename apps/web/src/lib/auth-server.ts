import { readSession } from "@repo/service/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { signedInLanding } from "#lib/next-path";

// A server render's session, read once per request. It lives here, not in @repo/service, since it
// reads next/headers; a render sets no cookie, so the read never slides the session (`readSession`).
export const getSession = cache(async () => await readSession(await headers()));

// A read that failed is logged and reads as signed out: all a skip does with a session is skip a
// form, so a fault draws the form.
const signedIn = async (): Promise<boolean> => {
  try {
    return (await getSession()) !== null;
  } catch (error) {
    console.error("[auth] the signed-in skip could not read the session", error);
    return false;
  }
};

// sign-in and sign-up, skipped for someone already signed in, to where they were going
export const skipWhenSignedIn = async (next: string | undefined): Promise<void> => {
  if (await signedIn()) {
    redirect(signedInLanding(next));
  }
};
