// Opening the user's browser, split into the pure decision and the one call
// that leaves the process. The decision is a table of per-platform commands so
// an unsupported platform is a stated null (the URL is already printed) rather
// than a spawn of something that does not exist.

import { spawn } from "node:child_process";

export interface OpenCommand {
  file: string;
  argv: readonly string[];
}

/** The opener for `platform` (a `process.platform` value), or null where this
 *  launcher has none — the caller falls back to the printed URL. */
export function resolveOpenCommand(platform: string, url: string): OpenCommand | null {
  switch (platform) {
    case "darwin":
      return { file: "open", argv: [url] };
    case "win32":
      // `start` is a cmd builtin, and its FIRST quoted argument is the window
      // title — the empty string is what keeps a quoted URL from being eaten
      // as one.
      return { file: "cmd", argv: ["/c", "start", "", url] };
    case "linux":
      return { file: "xdg-open", argv: [url] };
    default:
      return null;
  }
}

/**
 * Best-effort: a machine with no browser, no `xdg-open` or a refusing opener
 * must not take the server down with it, so a failure is swallowed and the
 * printed URL stands. Detached and unref'd because the opener outliving this
 * process is normal and waiting on it is not.
 */
export function openBrowser(platform: string, url: string): void {
  const command = resolveOpenCommand(platform, url);
  if (command === null) {
    return;
  }
  try {
    const child = spawn(command.file, [...command.argv], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is on stdout either way.
  }
}
