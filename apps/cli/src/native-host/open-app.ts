// how the browser's door brings the Mac app up: in front when the person asked for it (Open
// Inteligir, or a first run waiting on them), behind the browser when a save only needs its server.

import { spawn } from "node:child_process";
import { APP_BUNDLE_ID } from "../desktop/app-identity";

export type AppPlacement = "front" | "behind";

// answers whether it asked macOS to open the app; anywhere else there is no app to open
export type OpenApp = (placement: AppPlacement) => boolean;

// by absolute path: the launcher scrubs the environment, so there is no PATH to find `open` on
const OPEN = "/usr/bin/open";

export const openInteligir: OpenApp = (placement) => {
  if (process.platform !== "darwin") {
    return false;
  }
  const args = placement === "behind" ? ["-g", "-b", APP_BUNDLE_ID] : ["-b", APP_BUNDLE_ID];
  // ignored stdio: one byte of `open`'s on the host's stdout would corrupt the browser's pipe
  const child = spawn(OPEN, args, { detached: true, stdio: "ignore" });
  child.on("error", () => null);
  child.unref();
  return true;
};
