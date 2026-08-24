// The workspace document's Content-Security-Policy.
//
// A FIXED HEADER, not a per-request nonce, and that is what a plain SPA buys:
// the built shell carries exactly one module script and injects none at
// runtime, so `'self'` admits it and nothing else. A document server that
// injected further inline scripts per render is what forced a nonce with
// `'strict-dynamic'` — measured, not assumed, against the build that did it.
//
// WHAT THE BUNDLE FORCES, stated rather than discovered later:
//   - `style-src` needs 'unsafe-inline'. CodeMirror injects its theme as a
//     <style> element at runtime (StyleModule) and React writes style
//     attributes; neither is noncible from here. This is the one directive
//     weaker than it looks, and it is a real residual — a CSS injection is not
//     blocked.
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
    // See the header: CodeMirror's runtime <style> injection forces this.
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
