// The page's content policy: everything it draws is its own or bytes the phone handed it, and it
// opens no connection, since it reaches the library only through native's actions. Expo's page
// template carries no policy, so the page inserts this before it draws an item.

import { DRAWING_DIRECTIVES } from "@repo/editor/drawing-policy";

export const PAGE_POLICY = [
  ...DRAWING_DIRECTIVES,
  "script-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'self'",
  "worker-src 'none'",
].join("; ");

export const insertPagePolicy = (): void => {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = PAGE_POLICY;
  document.head.prepend(meta);
};
