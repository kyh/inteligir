// A note's inteligir-html block runs in a frame loaded from here, never in a srcdoc frame: srcdoc
// inherits the page's policy, whose `script-src 'self'` refuses every inline script the block
// holds. A navigated response carries its own policy instead, and this one is a sandbox with an
// opaque origin that reaches nothing: no fetch, no remote image, no storage, no form, and the
// page's `frame-src 'self'` refuses it a navigation away. The page posts the block's bytes once;
// only the window that framed it can, and the write replaces the listener with the document.
// Both stampers answer it: this server for a browser tab, the desktop protocol handler for the app.

export const HTML_FRAME_DOCUMENT = `<!doctype html>
<meta charset="utf-8">
<script>
addEventListener("message", (event) => {
  if (event.source !== parent || typeof event.data !== "string") return;
  document.open();
  document.write(event.data);
  document.close();
});
</script>
`;

export const HTML_FRAME_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": [
    "sandbox allow-scripts",
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
  ].join("; "),
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} satisfies Record<string, string>;
