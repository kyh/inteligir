// The consent page's two documents: the question, asked of a person signed in to the site, and
// the page a request that cannot be answered gets. Every string an assistant supplied (its name,
// its domain, where its access goes) is the client's own claim from its registration or its
// metadata document, so all of it is escaped (docs/consent-page.md in
// @cloudflare/workers-oauth-provider). The page runs no script and loads nothing.

import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

// the five characters that can end an attribute or open a tag, as numeric references
const escapeHtml = (value: string): string =>
  value.replaceAll(/[&<>"']/gu, (char) => `&#${String(char.codePointAt(0))};`);

// the site's own look in a few rules: no stylesheet to fetch, nothing a strict policy refuses
const STYLE = `
:root { color-scheme: light dark; --fg: #09090b; --muted: #71717a; --line: #e4e4e7; --bg: #fff; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #fafafa; --muted: #a1a1aa; --line: #27272a; --bg: #09090b; }
}
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 26rem; margin: 0 auto; padding: 4rem 1.5rem; }
.brand { font-weight: 500; margin: 0 0 2rem; }
h1 { font-size: 1.125rem; font-weight: 500; margin: 0 0 0.75rem; }
p { margin: 0 0 0.75rem; }
.muted { color: var(--muted); }
.warning { border: 1px solid var(--line); border-radius: 0.5rem; padding: 0.75rem; }
label { display: flex; gap: 0.5rem; align-items: center; margin: 1.25rem 0; }
.actions { display: flex; gap: 0.5rem; }
button { font: inherit; border-radius: 0.5rem; padding: 0.5rem 1rem; cursor: pointer;
  border: 1px solid var(--fg); background: var(--fg); color: var(--bg); }
button.secondary { background: transparent; color: var(--fg); border-color: var(--line); }
`;

// no script, no frame, nothing from elsewhere; a form posts back here alone
export const CONSENT_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

const documentOf = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">Inteligir</p>
${body}
</main>
</body>
</html>
`;

export interface ConsentQuestion {
  readonly details: ConsentDescription;
  // the consent transaction this form posts back, bound to this browser
  readonly handle: string;
  // whose library the person is signed in to
  readonly email: string;
}

export const consentPage = ({ details, email, handle }: ConsentQuestion): string => {
  const name = escapeHtml(details.clientName);
  const publisher =
    details.clientDomain === undefined
      ? "This app named itself, so nothing has checked that name."
      : `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`;
  const local = details.redirectIsLoopback
    ? `<p class="warning"><strong>This sends access to an app on this computer.</strong> Allow it only if you just started connecting from that app.</p>`
    : "";
  return documentOf(
    `Connect ${details.clientName} to your library`,
    `<h1>Allow ${name} to read and change your library?</h1>
<p>${name} will be able to search and read everything in the library you're signed in to as <strong>${escapeHtml(email)}</strong>, save links, write notes and change your items. Each change it makes shows in History, where you can undo it.</p>
<p class="muted">${publisher} Access is sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${local}
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<label><input type="checkbox" name="access" value="read"> Only let it read the library</label>
<div class="actions">
<button type="submit" name="decision" value="allow">Allow</button>
<button type="submit" name="decision" value="deny" class="secondary">Don't allow</button>
</div>
</form>
<p class="muted">To stop it, remove the connector in your assistant: its access then ends within 30 days.</p>`,
  );
};

// a request this page cannot answer: what to do next, and the provider's own reason beneath it
export const refusalPage = (sentence: string, detail: string | null): string =>
  documentOf(
    "This didn't connect",
    `<h1>This didn't connect</h1>
<p>${escapeHtml(sentence)}</p>
${detail === null ? "" : `<p class="muted">${escapeHtml(detail)}</p>`}`,
  );
