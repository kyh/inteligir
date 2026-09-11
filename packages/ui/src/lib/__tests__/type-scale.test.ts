import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { typeScale } from "../size-context";

const CSS = path.join(fileURLToPath(new URL("../../styles/globals.css", import.meta.url)));

const declaredPx = (source: string, role: string): number | null => {
  const match = new RegExp(`--text-${role}:\\s*(\\d+)px;`, "u").exec(source);
  return match?.[1] === undefined ? null : Number(match[1]);
};

// The utilities are the scale's compact column spelled in CSS. Two numbers for one role drift,
// and the drift shows up as a heading a notch off from the rows under it.
describe("the type-scale utilities", () => {
  it("carry the compact step of the one scale", () => {
    const source = fs.readFileSync(CSS, "utf-8");
    for (const [role, step] of Object.entries(typeScale)) {
      expect(declaredPx(source, role), `--text-${role}`).toBe(step.compact);
    }
  });
});
