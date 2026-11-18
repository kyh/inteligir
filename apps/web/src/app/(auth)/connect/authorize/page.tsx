import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SIGN_IN_PATH } from "@repo/contract/library-page";
import { readConsentRequest } from "@repo/service/auth/consent-request";
import type { ConsentRequest } from "@repo/service/auth/consent-request";

import { getSession } from "#lib/auth-server";
import { oauthQueryOf } from "#lib/oauth-query";

import { ConsentForm, ConsentRefused } from "./consent-form";

export const metadata: Metadata = { title: "Connect an assistant" };

const NOT_A_REQUEST: ConsentRequest = {
  kind: "refused",
  sentence: "This link isn't a request to connect. Start connecting again from your assistant.",
};

// Everything shown is read on the server from the request the provider signed, so nothing in the
// address but that request reaches the page.
const ConsentEntry = async ({
  searchParams,
}: Pick<PageProps<"/connect/authorize">, "searchParams">) => {
  const query = oauthQueryOf(await searchParams);
  const request = query === null ? NOT_A_REQUEST : await readConsentRequest(query);
  if (request.kind === "refused") {
    return <ConsentRefused sentence={request.sentence} />;
  }
  const session = await getSession();
  if (session === null) {
    // as the provider sends a person who isn't signed in, so the sign-in carries on to this page
    redirect(`${SIGN_IN_PATH}?${query ?? ""}`);
  }
  return <ConsentForm ask={request} email={session.user.email} />;
};

const ConsentPage = ({ searchParams }: PageProps<"/connect/authorize">) => (
  <Suspense fallback={null}>
    <ConsentEntry searchParams={searchParams} />
  </Suspense>
);

export default ConsentPage;
