// Whether a launch nothing chose a vault for is a first run: the browsers' door asks it before it
// starts a server, so a door on a fresh Mac starts none. Pure over the resolution and a filesystem
// a test points at a temp dir.

import type { ServerTarget } from "./server-start";

export type LaunchPlan =
  | { kind: "boot"; target: ServerTarget }
  // the target is the default vault, the one "Create a new vault" proposes
  | { kind: "first-run"; target: ServerTarget };

export interface LaunchArgs {
  target: ServerTarget;
  exists: (dir: string) => boolean;
}

// only a launch nothing chose a vault for, whose default vault is not there yet: an env pin, a
// selector in config.json or a default already made boots as it always has, so an upgrade, the
// CLI's own boots and a pinned harness never meet a first run
export const planLaunch = ({ target, exists }: LaunchArgs): LaunchPlan =>
  target.vaultDirSource === "default" &&
  target.dataDirSource === "default" &&
  !exists(target.vaultDir)
    ? { kind: "first-run", target }
    : { kind: "boot", target };
