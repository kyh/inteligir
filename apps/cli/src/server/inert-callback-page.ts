// The inert browser-facing page the loopback callbacks answer (pairing and
// connector OAuth): no script, no external asset, and headers that say so.
// Everything interpolated is this process's own text today, and the remote
// party's refusal sentence is the one piece that is not — escaped anyway,
// because "the source is trusted" is the assumption that stops being true
// without anyone editing this file.

export interface InertCallbackPage {
  status: 200 | 400;
  title: string;
  detail: string;
}

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES.get(character) ?? character);
}

export function renderInertCallbackPage(page: InertCallbackPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} — inteligir</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh;
         font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 28rem; padding: 2rem; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.75; }
</style>
</head>
<body><main><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.detail)}</p></main></body>
</html>
`;
}

/** The URL that reached a callback carries a live code, and the page links
 *  nowhere — but a policy is cheaper than reasoning about who might add a
 *  link later. */
export const INERT_CALLBACK_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} satisfies Record<string, string>;
