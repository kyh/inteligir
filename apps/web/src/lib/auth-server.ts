import { readSession } from "@repo/service/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { signedInLanding } from "#lib/next-path";

export const getSession = cache(async () => await readSession(await headers()));

const signedIn = async () => {
  try {
    return (await getSession()) !== null;
  } catch (error) {
    console.error("[auth] the signed-in skip could not read the session", error);

    return false;
  }
};

export const skipWhenSignedIn = async (next: string | undefined) => {
  if (await signedIn()) {
    redirect(signedInLanding(next));
  }
};
