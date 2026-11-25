import path from "node:path";

type Verdict = "allow" | "open-externally" | "deny";

const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const isWeb = (url: URL) => url.protocol === "http:" || url.protocol === "https:";

const isFrameDocument = (url: URL) =>
  url.protocol === "about:" && (url.pathname === "blank" || url.pathname === "srcdoc");

/**
 * What the window may show: the site's own pages, its blobs (a file the page saves) and the blank
 * documents of a frame; any other web page opens in the browser, and nothing else loads. Compared
 * by origin, never by prefix: `http://localhost:5174` prefixes `http://localhost:51740`, and a
 * blob's origin is the page's that made it.
 */
export const classify = (target: string, appUrl: string) => {
  const url = parse(target);

  if (url === null) {
    return "deny" satisfies Verdict;
  }

  if ((url.origin !== "null" && url.origin === new URL(appUrl).origin) || isFrameDocument(url)) {
    return "allow" satisfies Verdict;
  }

  return isWeb(url) ? ("open-externally" satisfies Verdict) : ("deny" satisfies Verdict);
};

/** A page's `window.open` or `target="_blank"`: never a second window, a web page in the browser. */
export const opensExternally = (target: string) => {
  const url = parse(target);

  return url !== null && isWeb(url);
};

/** View › Reload: the site's page the window shows again, or the site once it shows none of it. */
export const reloadTarget = (shown: string, appUrl: string) => {
  const url = parse(shown);

  return url !== null && url.origin !== "null" && url.origin === new URL(appUrl).origin
    ? "shown"
    : "site";
};

/** Where a download lands in the folder: its own name, or the first `name (n).ext` not taken. */
export const savePathOf = (
  folder: string,
  filename: string,
  taken: (candidate: string) => boolean,
) => {
  const safe = path.basename(filename) || "download";
  const { ext, name } = path.parse(safe);
  let candidate = path.join(folder, safe);

  for (let n = 1; taken(candidate); n += 1) {
    candidate = path.join(folder, `${name} (${n})${ext}`);
  }

  return candidate;
};
