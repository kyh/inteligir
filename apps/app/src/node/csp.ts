// The production Content-Security-Policy.
//
// A PER-RESPONSE NONCE, not a hash list, and the difference was measured
// rather than assumed. The document carries one inline script (TanStack
// Start's stream barrier) which hashes cleanly — but the router then INJECTS
// further inline scripts at runtime, whose content varies per render, so a
// hash allowlist blocks the app the moment it hydrates (verified against the
// real build: the browser refused an injected script and asked for a hash the
// document does not contain). `'strict-dynamic'` is the directive built for
// exactly that shape: the nonce admits the document's own scripts, and the
// scripts THEY insert inherit the trust, while nothing an injection can write
// into the document ever does.
//
// The nonce reaches the markup through Start itself, not through a rewrite of
// the built HTML: `src/node/app.ts` mints it per request and hands it to the
// Start entry, which stamps it on every tag it renders, on every script it
// injects mid-stream, and on the `<meta property="csp-nonce">` the client
// router reads it back from. A rewrite could only reach the tags that were
// already in the file.
//
// WHAT THE BUNDLE FORCES, stated rather than discovered later:
//   - `style-src` needs 'unsafe-inline'. CodeMirror injects its theme as a
//     <style> element at runtime (StyleModule) and React writes style
//     attributes; neither is noncible from here. This is the one directive
//     weaker than it looks, and it is a real residual — a CSS injection is not
//     blocked.
//   - `img-src` allows data: and blob: — pasted and embedded images — and
//     'self', which is where a vault image comes from (/api/v1/vault/asset).
//     It names no remote host, so a note embedding `![](https://…/x.png)`
//     does NOT load: the editor's image widget shows the embed's own bytes
//     and the reason instead of a gap. That is the intended answer for a
//     local-first notes app — a note cannot silently phone a third party, and
//     a remote image is a per-open beacon — but it is a REFUSAL, not a bug,
//     and widening it is a privacy decision rather than a rendering fix.
//   - No 'unsafe-eval' anywhere: nothing in the first-party source or the
//     editor stack evaluates strings.
//   - `connect-src` names the websocket origin EXPLICITLY as well as 'self'.
//     CSP3 says 'self' covers the ws: scheme of the same host and port, but
//     the invalidation socket is load-bearing and not worth a spec bet.
//
// The directive that matters most for THIS product is `connect-src`: a local
// notes server holds everything the user has written, and an injected script
// that cannot reach a third-party origin cannot exfiltrate any of it.

export interface ContentSecurityPolicyArgs {
  /** This response's nonce, base64 — the same one the document was rendered
   *  under. A policy naming any other value blocks every script on the page. */
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
    // 'self' rather than 'none' for the ONE frame this app draws: moss-html's
    // sandboxed srcdoc preview (opaque origin, never allow-same-origin — the
    // sandbox is the guard; this directive only refuses REMOTE frames, which
    // keeps the connect-src exfiltration story intact).
    "frame-src 'self'",
    "worker-src 'none'",
  ].join("; ");
}
