/**
 * Where sign-in is allowed to send someone afterwards.
 *
 * A guarded route that bounces a signed-out visitor has to say where they were
 * going, or the round trip loses it — and `/app/pair` carries the whole pairing
 * request in its search params, so losing them means the user lands back on a
 * page that cannot tell them what they came to approve.
 *
 * Carrying a destination across a sign-in is also the classic open redirect, so
 * the value is narrowed to a SAME-DOCUMENT path here rather than trusted:
 *
 *   - it must start with `/`, so no scheme and no bare host;
 *   - it must not start with `//` or `/\`, which browsers read as
 *     protocol-relative — `//evil.example` is an absolute URL wearing a path's
 *     clothes, and the backslash form is what several parsers normalise INTO
 *     the slash form;
 *   - it must still resolve inside a base origin afterwards, which is what
 *     settles the remaining encoding tricks without this module having to
 *     enumerate them.
 *
 * The base is a SENTINEL rather than the real origin: nothing here needs to
 * know which deployment is asking, and taking `window.location` would make a
 * pure function unusable from a server render and from a test.
 */
const RESOLUTION_BASE = "http://internal.invalid";

export function internalNextPath(value: string | undefined): string | null {
  if (value === undefined || !value.startsWith("/")) {
    return null;
  }
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(value, RESOLUTION_BASE);
  } catch {
    return null;
  }
  if (resolved.origin !== RESOLUTION_BASE) {
    return null;
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
