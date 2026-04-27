// ---------------------------------------------------------------------------
// Computer-use tool — native macOS GUI control via @injaneity/pi-computer-use
//
// This module imports the pi-computer-use package, so it should only be
// loaded when the agent actually starts (via dynamic import in setup.ts).
// The lightweight seed-helper logic lives in computer-use-helper.ts so
// onboarding can run without pulling the package's runtime into memory.
//
// Browser windows are intentionally out of scope — our CDP-based browser
// tool covers the web. computer-use-env.ts (imported below) sets
// PI_COMPUTER_USE_BROWSER_USE=0 so the bridge refuses browser targets;
// that import must precede the pi-computer-use import to take effect.
// ---------------------------------------------------------------------------

// MUST stay first — sets PI_COMPUTER_USE_BROWSER_USE=0 before the package loads.
// ESM evaluates imports depth-first in source order, so any side-effect import
// listed before the pi-computer-use import is guaranteed to run first.
import "@/agent/computer-use-env";
import computerUseExtension from "@injaneity/pi-computer-use/extensions/computer-use.ts";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Pi extension factory — registers list_apps, screenshot, click, etc. */
export function registerComputerUseExtension(pi: ExtensionAPI): void {
  computerUseExtension(pi);
}
