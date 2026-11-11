// The page's own door to the web, apart from the url helpers the headless codec reads, which run
// where there is no window (the Worker's library cell among them).

import { isHttpUrl } from "@repo/editor/lib/url";

// a note is untrusted: only an http(s) url reaches a new window, never a `javascript:` or `file:`
// one, and noopener keeps this window out of the opened page's reach.
export const openExternalUrl = (url: string): void => {
  if (isHttpUrl(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
