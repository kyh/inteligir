// The workspace document's Content-Security-Policy.
//
// A FIXED HEADER, and that is what a plain SPA buys: the built shell carries
// exactly one module script and injects none at runtime, so `'self'` admits it
// and nothing else. A document server that injects per-render inline scripts
// cannot have this policy — it needs a nonce with `'strict-dynamic'` — which is
// why deleting one was the price of the header.
//
// WHAT THE BUNDLE FORCES, stated rather than discovered later:
//   - `style-src` needs 'unsafe-inline'. React writes style attributes and the
//     Plate/lowlight editor stack injects <style> elements at runtime; neither
//     is noncible from here. This is the one directive weaker than it looks, and
//     it is a real residual — a CSS injection is not blocked.
//   - `img-src` allows data: and blob: — pasted and embedded images — and
//     'self'. It names no remote host, so a note embedding
//     `![](https://…/x.png)` does NOT load: the editor's image widget shows the
//     embed's own bytes and the reason instead of a gap. That is the intended
//     answer for a local-first notes app — a note cannot silently phone a third
//     party, and a remote image is a per-open beacon — but it is a REFUSAL, not
//     a bug, and widening it is a privacy decision rather than a rendering fix.
//   - No 'unsafe-eval' anywhere: nothing in the first-party source or the
//     editor stack evaluates strings.
//   - `worker-src 'none'` is load-bearing for a FEATURE, not just a hardening
//     line: it is why dictation captures with a ScriptProcessorNode rather than
//     an AudioWorklet, whose module is fetched as a script.
//   - `frame-src 'self'` for exactly one frame: inteligir-html's sandboxed
//     srcdoc preview (opaque origin, never allow-same-origin — the sandbox is
//     the guard; this directive only refuses REMOTE frames, which keeps the
//     connect-src exfiltration story intact).
//   - `connect-src` names the websocket origin EXPLICITLY as well as 'self'.
//     CSP3 says 'self' covers the ws: scheme of the same host and port, but
//     the invalidation socket is load-bearing and not worth a spec bet.
//
// The directive that matters most for THIS product is `connect-src`: a local
// notes server holds everything the user has written, and an injected script
// that cannot reach a third-party origin cannot exfiltrate any of it.

export interface ContentSecurityPolicyArgs {
  /** e.g. `ws://127.0.0.1:4664` — the invalidation bus's own origin. */
  wsOrigin: string;
}

export function buildContentSecurityPolicy(args: ContentSecurityPolicyArgs): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // See the header: React style attributes + Plate/lowlight's runtime <style>
    // injection force this.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${args.wsOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // The workspace is loaded in a top-level window (a browser tab or the
    // Electron shell) and never framed.
    "frame-ancestors 'none'",
    "frame-src 'self'",
    "worker-src 'none'",
  ].join("; ");
}

/**
 * The whole header set a DOCUMENT carries — the policy plus the two headers
 * that would be pointless without it.
 *
 * One table because there are two stampers: this server answers a browser, and
 * the desktop's protocol handler answers the window. Sharing only the policy
 * STRING left the headers around it free to diverge, which is the same rot
 * with a smaller blast radius.
 *
 * The token cookie is deliberately NOT here: it is the browser's credential and
 * the window never needs one, so it belongs to the caller that has a token to
 * hand out rather than to the shape of a secured document.
 */
export function documentSecurityHeaders(args: ContentSecurityPolicyArgs) {
  return {
    "content-security-policy": buildContentSecurityPolicy(args),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  } satisfies Record<string, string>;
}
