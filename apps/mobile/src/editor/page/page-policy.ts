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

export const insertPagePolicy = () => {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = PAGE_POLICY;
  document.head.prepend(meta);
};
