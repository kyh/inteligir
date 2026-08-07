// ---------------------------------------------------------------------------
// Which deployment this app talks to. One value, resolved once, so no screen
// composes a URL out of pieces.
//
// `EXPO_PUBLIC_INTELIGIR_URL` is inlined at bundle time by Expo, which is what
// points a dev build at a local Worker; anything that is not an http(s) URL
// falls through to the shipped default rather than producing a request nobody
// can debug.
// ---------------------------------------------------------------------------

const FALLBACK_URL = "https://inteligir.com";

/** `raw` reduced to an http(s) origin, or null when it is not one. Exported
 * for its own test: this value decides where every credential in the app is
 * sent, and a silently-wrong default is the failure nobody notices. */
export function parseDeploymentOrigin(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The origin every request in this app is built on. */
export const DEPLOYMENT_ORIGIN =
  parseDeploymentOrigin(process.env.EXPO_PUBLIC_INTELIGIR_URL) ?? FALLBACK_URL;

/** How the deployment reads in the UI — the host, without the scheme noise. */
export function deploymentLabel(): string {
  try {
    return new URL(DEPLOYMENT_ORIGIN).host;
  } catch {
    return DEPLOYMENT_ORIGIN;
  }
}
