export interface ContentSecurityPolicyArgs {
  wsOrigin: string;
}

export function buildContentSecurityPolicy(args: ContentSecurityPolicyArgs): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // react style attributes and plate/lowlight's runtime <style> injection are not noncible.
    "style-src 'self' 'unsafe-inline'",
    // no remote host: a remote embed is a per-open beacon, so it does not load; widening this is a privacy decision.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // csp3 says 'self' covers ws: on the same host and port; the bus is not worth the spec bet.
    `connect-src 'self' ${args.wsOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // one frame: inteligir-html's sandboxed srcdoc preview; remote frames stay refused.
    "frame-src 'self'",
    // an audioworklet module is fetched as a script, which is why dictation uses a scriptprocessornode.
    "worker-src 'none'",
  ].join("; ");
}

// one table for both stampers (this server and the desktop protocol handler).
// the token cookie is not here: the window never needs one, so it belongs to the caller that has a token.
export function documentSecurityHeaders(args: ContentSecurityPolicyArgs) {
  return {
    "content-security-policy": buildContentSecurityPolicy(args),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  } satisfies Record<string, string>;
}
