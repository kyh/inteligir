// The production Content-Security-Policy.
//
// A PER-RESPONSE NONCE, not a hash list, and the difference was measured
// rather than assumed. The built shell carries one inline script (TanStack
// Start's stream barrier) which hashes cleanly — but the router then INJECTS
// further inline scripts at runtime, whose content varies per render, so a
// hash allowlist blocks the app the moment it hydrates (verified against the
// real build: the browser refused an injected script and asked for a hash the
// shell does not contain). `'strict-dynamic'` is the directive built for
// exactly that shape: the nonce admits the shell's own scripts, and the
// scripts THEY insert inherit the trust, while nothing an injection can write
// into the document ever does.
//
// The cost, stated: the shell is rendered per navigation rather than served as
// a fixed buffer. It is ~1.4kB and already `no-store`, so this is a string
// substitution on a response that was never cacheable.
//
// WHAT THE BUNDLE FORCES, stated rather than discovered later:
//   - `style-src` needs 'unsafe-inline'. CodeMirror injects its theme as a
//     <style> element at runtime (StyleModule) and React writes style
//     attributes; neither is noncible from here. This is the one directive
//     weaker than it looks, and it is a real residual — a CSS injection is not
//     blocked.
//   - `img-src` allows data: and blob: — pasted and embedded images.
//   - No 'unsafe-eval' anywhere: nothing in the first-party source or the
//     editor stack evaluates strings.
//   - `connect-src` names the websocket origin EXPLICITLY as well as 'self'.
//     CSP3 says 'self' covers the ws: scheme of the same host and port, but
//     the invalidation socket is load-bearing and not worth a spec bet.
//
// The directive that matters most for THIS product is `connect-src`: a local
// notes server holds everything the user has written, and an injected script
// that cannot reach a third-party origin cannot exfiltrate any of it.

/** Substituted per response. Deliberately not a valid base64 nonce, so a
 *  template that escapes un-rendered is refused by the browser rather than
 *  quietly trusted. */
export const SHELL_NONCE_PLACEHOLDER = "__INTELIGIR_CSP_NONCE__";

/** Stamp the placeholder onto every `<script>` in the shell. Done once at
 *  boot; `renderShell` fills it in per response. */
export function prepareShellTemplate(html: string): string {
  return html.replaceAll("<script", `<script nonce="${SHELL_NONCE_PLACEHOLDER}"`);
}

export function renderShell(template: string, nonce: string): string {
  return template.replaceAll(SHELL_NONCE_PLACEHOLDER, nonce);
}

export interface ContentSecurityPolicyArgs {
  /** This response's nonce, base64 — the same one `renderShell` stamped. */
  nonce: string;
  /** e.g. `ws://127.0.0.1:4664` — the invalidation bus's own origin. */
  wsOrigin: string;
}

export function buildContentSecurityPolicy(args: ContentSecurityPolicyArgs): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${args.nonce}' 'strict-dynamic'`,
    // See the header: CodeMirror's runtime <style> injection forces this.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${args.wsOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // The shell is loaded in a top-level window (a browser tab or the Electron
    // shell) and never framed.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ].join("; ");
}
