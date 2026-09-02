// pure policy for index.ts; no `electron` import so it stays unit-testable.

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// not `URL.origin`: Node's parser answers "null" for any non-special scheme, so
// `inteligir://app` and `inteligir://evil` would compare equal.
function comparableOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.origin === "null" ? null : url.origin;
  }
  // `inteligir://app@evil/` parses to host `evil`.
  if (url.username.length > 0 || url.password.length > 0 || url.hostname.length === 0) {
    return null;
  }
  return `${url.protocol}//${url.hostname}`;
}

// not a prefix compare: `http://127.0.0.1:4664` prefixes `http://127.0.0.1:46640`.
export function isSameOriginNavigation(targetUrl: string, appOrigin: string): boolean {
  const pinned = comparableOrigin(appOrigin);
  return pinned !== null && comparableOrigin(targetUrl) === pinned;
}

export type NavigationVerdict = "allow" | "block-and-open-external" | "block";

export function classifyNavigation(targetUrl: string, appOrigin: string): NavigationVerdict {
  if (isSameOriginNavigation(targetUrl, appOrigin)) {
    return "allow";
  }
  return isHttpUrl(targetUrl) ? "block-and-open-external" : "block";
}

// the popup is always denied, the app's own origin included; the verdict only picks the hand-off.
export type WindowOpenVerdict = "deny-and-open-external" | "deny";

export function classifyWindowOpen(url: string): WindowOpenVerdict {
  return isHttpUrl(url) ? "deny-and-open-external" : "deny";
}

// Electron exposes no user-activation flag on `setWindowOpenHandler` or `will-navigate`,
// so the shell tracks `input-event` itself; without it a `window.open` loop is a loop of OS browser launches.
export const USER_ACTIVATION_WINDOW_MS = 3_000;

export interface ExternalOpenDecision {
  allowed: boolean;
  reason: "allowed" | "not-http" | "no-user-activation";
}

export interface ExternalOpenArgs {
  url: string;
  lastInputAt: number | null;
  now: number;
  windowMs?: number;
}

// page-initiated opens only; a menu click is its own gesture and produces no `input-event` to measure.
export function decideExternalOpen(args: ExternalOpenArgs): ExternalOpenDecision {
  if (!isHttpUrl(args.url)) {
    return { allowed: false, reason: "not-http" };
  }
  const windowMs = args.windowMs ?? USER_ACTIVATION_WINDOW_MS;
  if (args.lastInputAt === null || args.now - args.lastInputAt > windowMs) {
    return { allowed: false, reason: "no-user-activation" };
  }
  return { allowed: true, reason: "allowed" };
}

export function appWindowWebPreferences(preloadPath: string, partition: string) {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition,
  } as const;
}

// `media` is dictation's microphone; Electron grants most permissions by default, so everything else is denied here.
export const ALLOWED_PERMISSIONS: readonly string[] = ["media"];

// origin-scoped, not a bare allowlist: a subframe or embed must not inherit the grant.
export function classifyPermission(
  permission: string,
  requestingOrigin: string,
  appOrigin: string,
): boolean {
  if (!ALLOWED_PERMISSIONS.includes(permission)) {
    return false;
  }
  return isSameOriginNavigation(requestingOrigin, appOrigin);
}
