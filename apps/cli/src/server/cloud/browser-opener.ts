import { execFile } from "node:child_process";
import { promisify } from "node:util";

// oxlint-disable-next-line typescript/strict-void-return -- execFile returns the ChildProcess promisify's parameter type calls void; the promise keeps it as `.child`.
const run = promisify(execFile);

export type OpenExternalUrl = (url: string) => Promise<boolean>;

export interface OpenCommand {
  file: string;
  argv: readonly string[];
}

// open/xdg-open return once handed off; this bounds a wedged helper, not a page load.
const OPEN_TIMEOUT_MS = 5000;

export const resolveOpenCommand = (platform: string, url: string): OpenCommand | null => {
  switch (platform) {
    case "darwin": {
      return { argv: [url], file: "open" };
    }
    case "win32": {
      // not `cmd /c start`: cmd.exe re-parses the url's `&` as a command separator
      // (libuv quotes an arg only when it holds whitespace or a quote). rundll32
      // hands the whole url to the protocol handler through CreateProcess.
      return { argv: ["url.dll,FileProtocolHandler", url], file: "rundll32" };
    }
    case "linux": {
      return { argv: [url], file: "xdg-open" };
    }
    default: {
      return null;
    }
  }
};

// false is an ordinary answer: the url still works pasted anywhere.
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
