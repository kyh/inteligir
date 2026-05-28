import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { ArtifactsManager } from "@/main/artifacts";
import type { ArtifactSpec } from "@/shared/artifacts";

const SPEC: ArtifactSpec = {
  root: "r",
  elements: { r: { type: "Text", props: { text: "hi" } } },
};

let storePath: string;
let mgr: ArtifactsManager;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `artifacts-test-${Date.now()}-${Math.random()}.json`);
  mgr = new ArtifactsManager(storePath);
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

describe("ArtifactsManager.upsert", () => {
  it("creates with an id slugged from the title and preserves it on update", () => {
    const created = mgr.upsert({ title: "My Panel", spec: SPEC });
    expect(created.id).toBe("my-panel");
    expect(created.createdAt).toBe(created.updatedAt);

    const updated = mgr.upsert({ id: "my-panel", title: "Renamed", spec: SPEC });
    expect(updated.id).toBe("my-panel");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(mgr.list().artifacts).toHaveLength(1);
  });

  it("replaces in place so panel order is stable across updates", () => {
    mgr.upsert({ id: "a", title: "A", spec: SPEC });
    mgr.upsert({ id: "b", title: "B", spec: SPEC });
    mgr.upsert({ id: "a", title: "A2", spec: SPEC });
    expect(mgr.list().artifacts.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("ArtifactsManager.setState", () => {
  it("replaces state wholesale so cleared keys disappear, and bumps updatedAt", async () => {
    const created = mgr.upsert({ title: "S", spec: SPEC, state: { a: 1, b: 2 } });
    await new Promise((r) => setTimeout(r, 2));
    const next = mgr.setState(created.id, { a: 9 });
    expect(next?.state).toEqual({ a: 9 });
    expect(next?.state).not.toHaveProperty("b");
    expect(next!.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it("returns null for an unknown id", () => {
    expect(mgr.setState("nope", { a: 1 })).toBeNull();
  });
});

describe("ArtifactsManager.patch", () => {
  it("applies an RFC 6902 replace to the spec", () => {
    mgr.upsert({ id: "p", title: "P", spec: SPEC });
    const patched = mgr.patch({
      id: "p",
      ops: [{ op: "replace", path: "/elements/r/props/text", value: "bye" }],
    });
    expect(patched.spec.elements["r"]!.props["text"]).toBe("bye");
  });

  it("refuses a prototype-polluting path", () => {
    mgr.upsert({ id: "p", title: "P", spec: SPEC });
    expect(() =>
      mgr.patch({ id: "p", ops: [{ op: "add", path: "/__proto__/polluted", value: "x" }] }),
    ).toThrow(/prototype-reserved/);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
