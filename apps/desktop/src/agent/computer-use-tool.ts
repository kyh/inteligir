// Native macOS GUI control via @injaneity/pi-computer-use. Loaded lazily
// (dynamic import in setup.ts) so app startup doesn't pay for the package's
// runtime. The seed-helper module is split out so onboarding can run without
// pulling this in.
//
// computer-use-env.ts is imported below for its PI_COMPUTER_USE_BROWSER_USE=0
// side effect. ESM evaluates imports depth-first in source order, so listing
// it before the pi-computer-use import guarantees the env var is set before
// any of the package's modules can read it.

import type { ExtensionAPI } from "@repo/pi-driver";

import "@/agent/computer-use-env";
import computerUseExtension from "@injaneity/pi-computer-use/extensions/computer-use.ts";

export function registerComputerUseExtension(pi: ExtensionAPI): void {
  computerUseExtension(pi);
}
