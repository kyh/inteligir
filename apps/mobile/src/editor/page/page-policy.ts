// The page's content policy, built from the cloud's origin: everything it draws is its own or
// bytes the phone handed it, and the one connection it opens is the note's socket. Expo's page
// template carries no policy, so the page inserts this before it draws an item.

const socketOriginOf = (cloudOrigin: string): string => {
  const url = new URL(cloudOrigin);
  return `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
};

export const pagePolicy = (cloudOrigin: string): string =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src ${socketOriginOf(cloudOrigin)}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'self'",
    "worker-src 'none'",
  ].join("; ");

export const insertPagePolicy = (cloudOrigin: string): void => {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = pagePolicy(cloudOrigin);
  document.head.prepend(meta);
};
