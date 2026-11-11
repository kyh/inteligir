import { createMiddleware, createStart } from "@tanstack/react-start";

import { mintNonce, withPagePolicy } from "#lib/document-policy";

// The nonce goes into the request's context before the router is made, so getRouter hands it to
// every inline script Start writes (src/router.tsx), and the answer leaves carrying the policy that
// names it.
const documentPolicy = createMiddleware().server(async ({ next, request }) => {
  const nonce = mintNonce();
  const result = await next({ context: { nonce } });
  // the result, not a bare Response, so the nonce stays in the context type getRouter reads
  return { ...result, response: withPagePolicy(result.response, new URL(request.url), nonce) };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [documentPolicy],
}));
