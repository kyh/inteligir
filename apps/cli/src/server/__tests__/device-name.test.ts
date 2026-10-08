import { describe, expect, it } from "vitest";
import { readMachineName } from "../device-name";

describe("what this device is called", () => {
  it("names this machine as a person would, never by its network name", async () => {
    const name = await readMachineName();
    expect(name.trim()).toBe(name);
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(/\.local$/iu);
  });
});
