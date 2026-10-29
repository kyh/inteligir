// The connector's consent page, `/connect/authorize`: where a person's assistant sends them to be
// let into their library. A GET asks a person signed in to the site, or sends them to sign in and
// back; the POST takes their answer and hands the assistant its code, or its refusal. The provider
// validates the request, binds the form to this browser and keeps the request server-side between
// the two (docs/consent-page.md in @cloudflare/workers-oauth-provider); this route signs the person
// in, asks, and records whose library the grant opens and what it may do there.

import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";

import { createAuth } from "../auth/auth";
import { CONSENT_PAGE_POLICY, consentPage, refusalPage } from "./consent-page";
import { connectorAuth, READ_SCOPE } from "./connector-auth";

// where a person who is not signed in signs in, and is sent back from
const SIGN_IN_PATH = "/app/sign-in";

// a client's name as a grant keeps it: what it gave, at most as long as History shows
const NAME_MAX = 128;

const pageResponse = (html: string, status: number, headers = new Headers()): Response => {
  headers.set("cache-control", "no-store");
  headers.set("content-security-policy", CONSENT_PAGE_POLICY);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { headers, status });
};

const STARTED_ELSEWHERE = "Start connecting again from your assistant.";

// the form `consentPage` posts: its transaction, the answer, and the box that keeps a grant to
// reading
const consentFormSchema = z.object({
  access: z.literal("read").optional(),
  decision: z.enum(["allow", "deny"]),
  handle: z.string().min(1),
});

const signInFirst = (url: URL): Response => {
  const back = new URL(SIGN_IN_PATH, url);
  back.searchParams.set("next", `${url.pathname}${url.search}`);
  return Response.redirect(back.toString(), 302);
};

const ask = async (helpers: OAuthHelpers, request: Request, email: string): Promise<Response> => {
  const authRequest = await helpers.parseAuthRequest(request);
  // described first: a client that cannot be looked up leaves nothing in KV
  const details = await helpers.describeConsent(authRequest);
  const consent = await helpers.beginConsent(authRequest);
  return pageResponse(
    consentPage({ details, email, handle: consent.handle }),
    200,
    consent.headers,
  );
};

const answer = async (
  helpers: OAuthHelpers,
  request: Request,
  accountId: string,
): Promise<Response> => {
  const form = consentFormSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!form.success) {
    return pageResponse(
      refusalPage(`This page was sent incomplete. ${STARTED_ELSEWHERE}`, null),
      400,
    );
  }
  const { access, decision, handle } = form.data;
  if (decision === "deny") {
    const denied = await helpers.denyConsent(request, handle);
    return new Response(null, { headers: denied.headers, status: 302 });
  }
  // `library` reads and changes; the box the person ticked keeps the grant to reading
  const scope = access === "read" ? [READ_SCOPE] : ["library"];
  const approved = await helpers.approveConsent(request, handle, { scope });
  const { clientName } = await helpers.describeConsent(approved.request);
  const name = [...clientName.trim()].slice(0, NAME_MAX).join("");
  const { redirectTo } = await helpers.completeAuthorization({
    metadata: { clientName: name },
    props: { accountId, clientName: name },
    request: approved.request,
    scope: approved.request.scope,
    userId: accountId,
  });
  approved.headers.set("location", redirectTo);
  return new Response(null, { headers: approved.headers, status: 302 });
};

export const handleConsent = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, { headers: { allow: "GET, POST" }, status: 405 });
  }
  const url = new URL(request.url);
  const signedIn = await createAuth(env, ctx.exports, url.origin).api.getSession({
    headers: request.headers,
  });
  if (signedIn === null) {
    return request.method === "GET"
      ? signInFirst(url)
      : pageResponse(refusalPage(`You were signed out. ${STARTED_ELSEWHERE}`, null), 401);
  }
  const { helpers } = connectorAuth(env);
  try {
    return request.method === "GET"
      ? await ask(helpers, request, signedIn.user.email)
      : await answer(helpers, request, signedIn.user.id);
  } catch (error) {
    // the refusals a person can meet here, in their words; anything else is a fault, never theirs
    if (error instanceof AuthorizationError) {
      // a request the provider validated as far as its redirect sends the client its error
      if (error.redirectTo !== undefined) {
        return Response.redirect(error.redirectTo, 302);
      }
      return pageResponse(
        refusalPage(
          `This link expired or was already used. ${STARTED_ELSEWHERE}`,
          error.description,
        ),
        400,
      );
    }
    if (error instanceof CimdFetchError) {
      console.warn({ detail: error.detail, event: "connector-client-unresolved" });
      return pageResponse(
        refusalPage(`The assistant's details couldn't be checked. ${STARTED_ELSEWHERE}`, null),
        400,
      );
    }
    throw error;
  }
};
