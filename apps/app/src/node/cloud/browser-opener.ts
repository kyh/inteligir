// Opening the user's browser at a URL this process composed — the step that
// turns "pair with browser" into a window the user is already looking at.
//
// The decision is a per-platform TABLE and the launch is `execFile` with an
// argv list, never a shell. The URL here is not attacker-controlled (it is the
// configured deployment's origin plus a hex state), but a shell in this path
// would be a shell in every future path, and the discipline is what makes that
// sentence still true later. The same reason `connectors/codex-mcp.ts` drives
// codex with an argv list.
//
// SEPARATE from `apps/launcher/src/open-browser.ts`, which cannot be imported
// from here: the launcher is a standalone bundle with no workspace
// dependencies, and it wants the opposite behaviour — detached, unref'd, never
// waited on, because it has already printed the URL. This one is AWAITED,
// because its caller answers `opened` over the wire and a claim nobody checked
// is worse than no claim.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * How this process asks the desktop to show a URL. Injected everywhere it is
 * used so a suite can watch it without a browser window appearing on whoever
 * is running the tests.
 */
export type OpenExternalUrl = (url: string) => Promise<boolean>;

export interface OpenCommand {
  file: string;
  argv: readonly string[];
}

/**
 * How long the opener gets. `open` and `xdg-open` return as soon as they have
 * handed the URL off, so this is not a page-load budget — it is a bound on a
 * wedged helper, because the HTTP response that reports `opened` is waiting
 * behind it.
 */
const OPEN_TIMEOUT_MS = 5_000;

/** The opener for `platform` (a `process.platform` value), or null where there
 *  is none — the caller still has the URL to show. */
export function resolveOpenCommand(platform: string, url: string): OpenCommand | null {
  switch (platform) {
    case "darwin":
      return { file: "open", argv: [url] };
    case "win32":
      // `start` is a cmd BUILTIN rather than an executable, so the file is cmd
      // and `start` is its argument; the empty string after it is the window
      // title, which is what stops a quoted URL from being eaten as one.
      return { file: "cmd", argv: ["/c", "start", "", url] };
    case "linux":
      return { file: "xdg-open", argv: [url] };
    default:
      return null;
  }
}

/**
 * Best-effort, and it SAYS so: false is an ordinary answer, not an exception.
 * A headless box, a machine with no `xdg-open`, a refusing opener — none of
 * them is a reason to fail the pairing, because the URL the caller is holding
 * still works when it is pasted somewhere.
 */
export const systemOpenExternalUrl: OpenExternalUrl = async (url) => {
  const command = resolveOpenCommand(process.platform, url);
  if (command === null) {
    return false;
  }
  try {
    await run(command.file, [...command.argv], { timeout: OPEN_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
};
