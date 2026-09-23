// the server's own browser landings, a connector's oauth callback and a tab with no session: a
// page that runs no script and loads nothing, since the tab it lands in is not one it trusts.
export interface InertPage {
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

const escapeHtml = (value: string): string =>
  value.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES.get(character) ?? character);

export const renderInertPage = (page: InertPage): string =>
  `<!doctype html>
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

// a callback url carries a live code; no-referrer keeps it off any link added later.
export const INERT_PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} satisfies Record<string, string>;
