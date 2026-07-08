// ---------------------------------------------------------------------------
// HTML-App runtime injection — the ONE place the vendored host deps + the
// bridge runtime are woven into an app's HTML. Pure string surgery + `?raw`
// asset strings, with NO electron/node imports, so BOTH sides can use it:
//   • main  — the vault-app:// protocol injects on every `.html` response.
//   • renderer (harness) — the browser dev harness has no protocol, so the
//     HTML-App view assembles a blob: URL from the fixture bytes with the exact
//     same injection (the broker works identically over either URL).
//
// The injected-deps set is a VERSIONED CONTRACT with every app an agent ever
// wrote: additions are append-only, removals are breaking. Everything is
// vendored under resources/html-app-runtime and inlined here — never a CDN.
// ---------------------------------------------------------------------------

import runtimeJs from "../resources/html-app-runtime/runtime.js?raw";
import themeCss from "../resources/html-app-runtime/theme.css?raw";
import tailwindJs from "../resources/html-app-runtime/tailwind.global.js?raw";
import alpineJs from "../resources/html-app-runtime/alpine.min.js?raw";

// <head>: the theme variables, then the runtime bridge (so `window.inteligir`
// exists before any app code runs), then the Tailwind browser compiler.
const HEAD_INJECTION = [
  `<style data-inteligir-injected>${themeCss}</style>`,
  `<script data-inteligir-injected>${runtimeJs}</script>`,
  `<script data-inteligir-injected>${tailwindJs}</script>`,
].join("\n");

// End of <body>: Alpine, deferred (it auto-inits on DOMContentLoaded).
const BODY_INJECTION = `<script data-inteligir-injected defer>${alpineJs}</script>`;

/** Inject the host runtime/deps into an app's HTML. Robust to a missing
 * `</head>`/`</body>` (some agent-written apps are fragments). Injected nodes
 * carry `data-inteligir-injected` so app and reviewer can tell them apart. */
export function injectHtmlAppRuntime(html: string): string {
  let out: string;
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose !== -1) {
    out = html.slice(0, headClose) + HEAD_INJECTION + "\n" + html.slice(headClose);
  } else {
    out = HEAD_INJECTION + "\n" + html;
  }
  const bodyClose = out.search(/<\/body\s*>/i);
  if (bodyClose !== -1) {
    out = out.slice(0, bodyClose) + BODY_INJECTION + "\n" + out.slice(bodyClose);
  } else {
    out = out + "\n" + BODY_INJECTION;
  }
  return out;
}
