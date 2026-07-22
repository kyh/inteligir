import { describe, expect, it } from "vitest";

import {
  appendCapture,
  foldCaptureText,
  todayDailyNotePath,
  type CaptureIo,
} from "../daily-capture";

// A fixed "today" (local time) so every path assertion is deterministic.
const NOW = new Date(2026, 6, 21, 9, 30); // 2026-07-21
const TODAY = "journal/2026-07-21.md";

/** In-memory CaptureIo + the backing map for assertions. */
function memIo(seed: Record<string, string> = {}): { io: CaptureIo; files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    io: {
      read: (path) => files.get(path) ?? null,
      write: (path, text) => {
        files.set(path, text);
      },
    },
  };
}

describe("todayDailyNotePath", () => {
  it("uses the shared desktop defaults: journal/YYYY-MM-DD.md", () => {
    expect(todayDailyNotePath(NOW)).toBe(TODAY);
  });
});

describe("foldCaptureText", () => {
  it("collapses whitespace runs (pasted multi-line → one line) and trims", () => {
    expect(foldCaptureText("  buy\tmilk\n\nand   eggs  ")).toBe("buy milk and eggs");
  });

  it("strips control characters", () => {
    expect(foldCaptureText("a\u0000b\u009Fc")).toBe("abc");
  });

  it("keeps first-party markdown intact — #tags and [[links]] survive", () => {
    expect(foldCaptureText("call mom #family, see [[Trip plan]]")).toBe(
      "call mom #family, see [[Trip plan]]",
    );
  });

  it("returns null when nothing printable remains", () => {
    expect(foldCaptureText("   \n\t \u0007 ")).toBeNull();
  });
});

describe("appendCapture", () => {
  it("creates a missing daily note with the line and a trailing newline", () => {
    const { io, files } = memIo();
    const result = appendCapture(io, "append", "buy milk", NOW);
    expect(result).toEqual({ kind: "appended", path: TODAY, line: "- buy milk" });
    expect(files.get(TODAY)).toBe("- buy milk\n");
  });

  it("formats a task capture as an unchecked box", () => {
    const { io, files } = memIo();
    const result = appendCapture(io, "task", "call mom", NOW);
    expect(result).toEqual({ kind: "appended", path: TODAY, line: "- [ ] call mom" });
    expect(files.get(TODAY)).toBe("- [ ] call mom\n");
  });

  it("appends after existing content that ends with a newline", () => {
    const { io, files } = memIo({ [TODAY]: "# Today\n\n- earlier\n" });
    appendCapture(io, "append", "later", NOW);
    expect(files.get(TODAY)).toBe("# Today\n\n- earlier\n- later\n");
  });

  it("inserts the separating newline when the file lacks a trailing one", () => {
    const { io, files } = memIo({ [TODAY]: "no trailing newline" });
    appendCapture(io, "append", "next", NOW);
    expect(files.get(TODAY)).toBe("no trailing newline\n- next\n");
  });

  it("appends a deliberately repeated capture twice — no dedupe", () => {
    const { io, files } = memIo();
    appendCapture(io, "task", "follow up", NOW);
    appendCapture(io, "task", "follow up", NOW);
    expect(files.get(TODAY)).toBe("- [ ] follow up\n- [ ] follow up\n");
  });

  it("seeds a missing daily note from templates/daily.md with placeholders applied", () => {
    const { io, files } = memIo({
      "templates/daily.md": "# {{title}}\n\ndate: {{date}}\n",
    });
    appendCapture(io, "append", "seeded capture", NOW);
    expect(files.get(TODAY)).toBe("# 2026-07-21\n\ndate: 2026-07-21\n- seeded capture\n");
  });

  it("folds the raw input before formatting the line", () => {
    const { io, files } = memIo();
    appendCapture(io, "append", "  spaced\nout  ", NOW);
    expect(files.get(TODAY)).toBe("- spaced out\n");
  });

  it("refuses an empty capture without touching the vault", () => {
    const { io, files } = memIo({ [TODAY]: "untouched\n" });
    expect(appendCapture(io, "append", "   \n ", NOW)).toEqual({ kind: "empty" });
    expect(files.get(TODAY)).toBe("untouched\n");
  });
});
