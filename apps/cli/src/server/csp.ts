export interface ContentSecurityPolicyArgs {
  wsOrigin: string;
}

export const buildContentSecurityPolicy = (args: ContentSecurityPolicyArgs): string =>
  [
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
    // inteligir-html's two frames, the srcdoc preview and the loader in html-block-frame.ts that
    // Run navigates to; remote frames stay refused, which also refuses a running block a way out.
    "frame-src 'self'",
    // an audioworklet module is fetched as a script, which is why dictation uses a scriptprocessornode.
    "worker-src 'none'",
  ].join("; ");

// one table for both stampers (this server and the desktop protocol handler).
// the token cookie is not here: the window never needs one, so it belongs to the caller that has a token.
export const documentSecurityHeaders = (args: ContentSecurityPolicyArgs) =>
  ({
    "content-security-policy": buildContentSecurityPolicy(args),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  }) satisfies Record<string, string>;
