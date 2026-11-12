import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cn, TYPE_ROLES } from "./cn";

const CSS = path.resolve(import.meta.dirname, "../styles/globals.css");

describe("the type-scale utilities", () => {
  it("are the roles the sheet declares", () => {
    const source = fs.readFileSync(CSS, "utf-8");
    const declared = [...source.matchAll(/--text-(?<role>\w+):\s*\d+px;/gu)].map(
      (match) => match.groups?.role,
    );
    expect(new Set(declared)).toStrictEqual(new Set(TYPE_ROLES));
  });

  it("survive a merge beside a text colour", () => {
    // the engine reads any unknown value after `text-` as a colour unless told otherwise, and a
    // dropped role falls back to the inherited 16px
    for (const role of TYPE_ROLES) {
      expect(cn(`text-${role}`, "text-muted-foreground"), role).toBe(
        `text-${role} text-muted-foreground`,
      );
    }
    expect(cn("text-caption", "text-title")).toBe("text-title");
  });
});
