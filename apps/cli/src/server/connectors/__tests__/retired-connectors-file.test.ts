import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { removeRetiredConnectorsFile } from "../retired-connectors-file";

describe("the retired connectors registry", () => {
  it("is deleted from the data dir, and nothing beside it is", () => {
    const dataDir = makeTempDir("retired-connectors-");
    const registry = path.join(dataDir, "connectors.json");
    const beside = path.join(dataDir, "agent-prefs.json");
    writeFileSync(registry, JSON.stringify({ servers: [] }), { mode: 0o600 });
    writeFileSync(beside, "{}");

    removeRetiredConnectorsFile(dataDir);

    expect(existsSync(registry)).toBe(false);
    expect(existsSync(beside)).toBe(true);
  });

  it("answers a data dir that never held one", () => {
    expect(() => {
      removeRetiredConnectorsFile(makeTempDir("retired-connectors-"));
    }).not.toThrow();
  });
});
