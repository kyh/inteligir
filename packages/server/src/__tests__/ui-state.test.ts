import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { UiStateManager } from "../ui-state";

let storePath: string;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `ui-state-test-${Date.now()}-${Math.random()}.json`);
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

// ui-state is a GENERIC key→value store — no per-feature key knowledge, and
// credentials never live here.
describe("UiStateManager", () => {
  it("stores and returns plain keys", () => {
    const mgr = new UiStateManager(storePath);

    mgr.set("panel.layout", { open: true });

    expect(mgr.getAll()).toEqual({ "panel.layout": { open: true } });
  });

  it("removes a key when set to undefined", () => {
    const mgr = new UiStateManager(storePath);

    mgr.set("panel.layout", { open: true });
    mgr.set("panel.layout", undefined);

    expect("panel.layout" in mgr.getAll()).toBe(false);
  });

  it("persists across instances over the same path", () => {
    new UiStateManager(storePath).set("theme", "dark");

    expect(new UiStateManager(storePath).getAll()).toEqual({ theme: "dark" });
  });
});
