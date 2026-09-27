// the page a tab with no session lands on: it runs no script and loads nothing, since the tab it
// lands in is not one it trusts. it names every way in, since a tab cannot tell which one its user
// has: a spent link, a restarted server and a bookmark all land here alike.
export const SIGNED_OUT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This tab is signed out — inteligir</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh;
         font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 28rem; padding: 2rem; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.75; }
</style>
</head>
<body><main><h1>This tab is signed out</h1><p>A browser signs in through a one-time link, and this tab holds no sign-in this server accepts: the link was already used or expired, or the server restarted. Run &quot;inteligir open&quot; in a terminal, or choose Help → Open in Browser in the desktop app.</p></main></body>
</html>
`;

// no-referrer: a link added later hands no other origin even this page's address.
export const SIGNED_OUT_PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} satisfies Record<string, string>;
