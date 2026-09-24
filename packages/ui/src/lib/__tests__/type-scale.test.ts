// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cn } from "../cn";
import { typeScale, useSize } from "../size-context";

const CSS = path.resolve(import.meta.dirname, "../../styles/globals.css");

const declaredPx = (source: string, role: string): number | null => {
  const match = new RegExp(`--text-${role}:\\s*(\\d+)px;`, "u").exec(source);
  return match?.[1] === undefined ? null : Number(match[1]);
};

// The utilities are the scale's compact column spelled in CSS. Two numbers for one role drift,
// and the drift shows up as a heading a notch off from the rows under it.
describe("the type-scale utilities", () => {
  it("survive a merge beside a text colour", () => {
    // the engine reads any unknown value after `text-` as a colour unless told otherwise, and a
    // dropped role falls back to the inherited 16px
    for (const role of Object.keys(typeScale)) {
      expect(cn(`text-${role}`, "text-muted-foreground"), role).toBe(
        `text-${role} text-muted-foreground`,
      );
    }
    expect(cn("text-caption", "text-title")).toBe("text-title");
  });

  it("carry the compact step of the one scale", () => {
    const source = fs.readFileSync(CSS, "utf-8");
    for (const [role, step] of Object.entries(typeScale)) {
      expect(declaredPx(source, role), `--text-${role}`).toBe(step.compact);
    }
  });

  // a sized control's text is the body role; spelled apart from the scale, it drifts off the rows
  // a role utility draws beside it
  it("are what a sized control draws as its body text", () => {
    expect(renderHook(() => useSize("compact")).result.current.text).toBe("text-body");
    expect(renderHook(() => useSize("default")).result.current.text).toBe(
      `text-[${typeScale.body.default}px]`,
    );
  });
});
